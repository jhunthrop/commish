// Package solo is the solo mock room (docs/design/2026-10-12-mock-room-
// rethink.md, "the solo room: the mock is a function"): no clock and no
// reveal. Creating a mock and every pick resolve every bot pick to the
// drafter's next turn in one transaction, stamped with no delay; undo is
// the log cut back to a pick; the card is recorded the first time it is
// read and written with the pick; the report is computed once a draft is
// finished; a share link carries the settings, the seed and the picks.
package solo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// maxSeed is the engine's seed space: mulberry32 takes 32 bits.
const maxSeed = 1<<32 - 1

// sharedEpoch stamps a shared replay's START_DRAFT. The solo room has no
// clock, so the stamp moves nothing but the log's own times.
const sharedEpoch = "2026-08-15T18:00:00.000Z"

// Repository is the part of mocks.Store the room uses.
type Repository interface {
	Start(ctx context.Context, accountID uuid.UUID, n mocks.NewMock) (apitypes.Mock, error)
	ReadLog(ctx context.Context, accountID, id uuid.UUID) (mocks.Log, error)
	AppendActions(ctx context.Context, accountID, id uuid.UUID, afterSeq int64, actions []mocks.Action, completedAt *time.Time) error
	Truncate(ctx context.Context, accountID, id uuid.UUID, head, fromSeq int64, keepCardsThrough int) error
	Card(ctx context.Context, id uuid.UUID, pick int) (json.RawMessage, bool, error)
	PutCard(ctx context.Context, id uuid.UUID, pick int, card any) error
	Report(ctx context.Context, accountID, id uuid.UUID) (json.RawMessage, bool, error)
	PutReport(ctx context.Context, accountID, id uuid.UUID, head int64, report any, at time.Time) error
}

// LeagueReader is the part of leagues.Store a mock reads.
type LeagueReader interface {
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.League, error)
}

// SettingsGate checks a mock's settings and the features they need.
// *leagues.Gate implements it.
type SettingsGate interface {
	Check(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, s apitypes.LeagueSettings, prefix string) bool
}

// SheetOrder is the account's newest cheat sheet, the stand-in's second
// source. *sheets.Store implements it.
type SheetOrder interface {
	Order(ctx context.Context, accountID uuid.UUID) ([]string, error)
}

// BoardSource is the board a league drafts from. *draftroom.Boards
// implements it.
type BoardSource interface {
	For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error)
}

// Service is the solo room.
type Service struct {
	Mocks   Repository
	Leagues LeagueReader
	Gate    SettingsGate
	Sheets  SheetOrder
	Boards  BoardSource
	Advisor advisor.Advisor
	// Hindsight answers a report's pick that recorded no odds.
	Hindsight     mock.Odds
	ReportWorkers int
	Now           func() time.Time
	Log           *slog.Logger

	shared sharedReports
}

// room is one mock as replayed for a request.
type room struct {
	mock     apitypes.Mock
	settings mock.Settings
	seed     uint32
	board    boards.Board
	draft    mock.Draft
	head     int64
}

// stamp is an instant as the engine's timestamps read: whole milliseconds.
func stamp(t time.Time) string { return draft.FormatMillis(t.UnixMilli()) }

func (s *Service) now() time.Time { return s.Now().UTC().Truncate(time.Millisecond) }

// load replays one of the account's mocks from its log.
func (s *Service) load(ctx context.Context, accountID, id uuid.UUID) (room, error) {
	log, err := s.Mocks.ReadLog(ctx, accountID, id)
	if err != nil {
		return room{}, err
	}
	board, err := s.Boards.For(ctx, log.Mock.Settings)
	if err != nil {
		return room{}, err
	}
	settings := mock.Settings{League: log.Mock.Settings, Pool: board.Pool(), StartedAt: stamp(log.Mock.CreatedAt)}
	seed := uint32(log.Mock.Seed)
	d, err := mock.FromLog(settings, seed, log.Payloads)
	if err != nil {
		return room{}, fmt.Errorf("solo: replay %s: %w", id, err)
	}
	return room{mock: log.Mock, settings: settings, seed: seed, board: board, draft: d, head: log.Head}, nil
}

// errNotWaiting is a pick, a card or a stand-in asked for when the draft
// is not on the drafter.
var errNotWaiting = errors.New("solo: not your turn")

// errNotFinished is a report asked for before the last pick.
var errNotFinished = errors.New("solo: the draft is not finished")

// errWrongPick is a pick made against a turn that has passed.
var errWrongPick = errors.New("solo: that pick has passed")

// append writes the actions after the ones r had, closing the mock when
// the draft is over.
func (s *Service) append(ctx context.Context, accountID uuid.UUID, r room, next mock.Draft, at time.Time) (room, error) {
	entries, err := mock.LogEntries(next, len(r.draft.Actions)+1)
	if err != nil {
		return room{}, err
	}
	var completed *time.Time
	if draft.IsComplete(next.State) {
		completed = &at
	}
	if err := s.Mocks.AppendActions(ctx, accountID, r.mock.Id, r.head, entries, completed); err != nil {
		return room{}, err
	}
	r.draft, r.head = next, r.head+int64(len(entries))
	if completed != nil {
		r.mock.Status = apitypes.MockStatusComplete
	}
	return r, nil
}

// recordedOdds is the card the room showed at a pick, as the pick records it.
func (s *Service) recordedOdds(ctx context.Context, id uuid.UUID, pick int) (*mock.PickOdds, error) {
	raw, ok, err := s.Mocks.Card(ctx, id, pick)
	if err != nil || !ok {
		return nil, err
	}
	var card advisor.Card
	if err := json.Unmarshal(raw, &card); err != nil {
		return nil, fmt.Errorf("solo: decode card %s at %d: %w", id, pick, err)
	}
	return draftroom.PickOdds(card), nil
}

// pick is the drafter's pick and every bot pick to the next turn.
func (s *Service) pick(ctx context.Context, accountID, id uuid.UUID, in apitypes.MockPickInput) (room, error) {
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return room{}, err
	}
	if !r.draft.Waiting {
		return room{}, errNotWaiting
	}
	if in.Pick != r.draft.State.PickNumber {
		return room{}, errWrongPick
	}
	odds, err := s.recordedOdds(ctx, id, in.Pick)
	if err != nil {
		return room{}, err
	}
	at := s.now()
	next, err := mock.Advance(r.settings, r.seed, r.draft, mock.HumanPick{PlayerID: in.PlayerId, At: stamp(at), Odds: odds}, mock.Options{})
	if err != nil {
		return room{}, err
	}
	return s.append(ctx, accountID, r, next, at)
}

// autopick is "Pick for me to round N": the drafter's turns through that
// round go to the stand-in, queue then sheet then board.
func (s *Service) autopick(ctx context.Context, accountID, id uuid.UUID, through int) (room, error) {
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return room{}, err
	}
	if !r.draft.Waiting {
		return room{}, errNotWaiting
	}
	sheet, err := s.Sheets.Order(ctx, accountID)
	if err != nil {
		return room{}, err
	}
	keepers := mock.KeepersOf(r.settings.League)
	at := s.now()
	next := r.draft
	teams := len(next.State.DraftOrder)
	for next.Waiting && draft.RoundForPick(teams, next.State.PickNumber) <= through {
		choice, ok := draftroom.StandIn(next.State, next.HumanTeamID, sheet, keepers.HeldBack(next.State))
		if !ok {
			break
		}
		if next, err = mock.Advance(r.settings, r.seed, next, mock.HumanPick{PlayerID: choice, At: stamp(at)}, mock.Options{}); err != nil {
			return room{}, err
		}
	}
	if len(next.Actions) == len(r.draft.Actions) {
		return r, nil
	}
	return s.append(ctx, accountID, r, next, at)
}

// setQueue replaces the drafter's queue.
func (s *Service) setQueue(ctx context.Context, accountID, id uuid.UUID, ids []string) (room, error) {
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return room{}, err
	}
	if draft.IsComplete(r.draft.State) {
		return room{}, errNotWaiting
	}
	at := s.now()
	when := stamp(at)
	if n := len(r.draft.Actions); n > 0 {
		last, err := draft.ParseMillis(r.draft.Actions[n-1].Timestamp)
		if err != nil {
			return room{}, err
		}
		if last > at.UnixMilli() {
			when = r.draft.Actions[n-1].Timestamp
		}
	}
	a := draft.NewSetQueue(when, r.draft.HumanTeamID, dedupe(ids))
	state, err := draft.Submit(r.draft.State, a)
	if err != nil {
		return room{}, err
	}
	next := r.draft
	next.Actions = append(append([]draft.Action(nil), r.draft.Actions...), a)
	next.State = state
	return s.append(ctx, accountID, r, next, at)
}

func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// errNotYours is an undo of a pick that was not the drafter's to take back.
var errNotYours = &draft.Refusal{Reason: "That pick is not one of yours to take back."}

// undo cuts the log back to just before the drafter's pick at pickNumber.
func (s *Service) undo(ctx context.Context, accountID, id uuid.UUID, pickNumber int) (room, error) {
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return room{}, err
	}
	seq, err := humanPickSeq(r.draft, mock.KeepersOf(r.settings.League), pickNumber)
	if err != nil {
		return room{}, err
	}
	if err := s.Mocks.Truncate(ctx, accountID, id, r.head, int64(seq), pickNumber); err != nil {
		return room{}, err
	}
	return s.load(ctx, accountID, id)
}

// humanPickSeq is the 1-based seq of the MAKE_PICK that made the
// drafter's pick at pickNumber, refusing a keeper and anyone else's pick.
func humanPickSeq(d mock.Draft, keepers sim.Keepers, pickNumber int) (int, error) {
	s := draft.Initial(d.Config)
	for i, a := range d.Actions {
		before := s
		next, err := draft.Reduce(s, a)
		if err != nil {
			return 0, fmt.Errorf("solo: replay for undo: %w", err)
		}
		s = next
		if a.Type != draft.MakePick || before.PickNumber != pickNumber {
			continue
		}
		if a.TeamID != d.HumanTeamID {
			return 0, errNotYours
		}
		if kept, forced := keepers.Forced(before, d.HumanTeamID); forced && kept == a.PlayerID {
			return 0, &draft.Refusal{Reason: "A keeper stays where the league put him."}
		}
		return i + 1, nil
	}
	return 0, errNotYours
}

// card is the drafter's card at the current turn, recorded on first read.
func (s *Service) card(ctx context.Context, accountID, id uuid.UUID) (apitypes.RoomCard, error) {
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return apitypes.RoomCard{}, err
	}
	if !r.draft.Waiting {
		return apitypes.RoomCard{}, errNotWaiting
	}
	pick := r.draft.State.PickNumber
	raw, ok, err := s.Mocks.Card(ctx, id, pick)
	if err != nil {
		return apitypes.RoomCard{}, err
	}
	if !ok {
		c, err := s.Advisor.Card(ctx, advisor.Request{
			State: r.draft.State, TeamID: r.draft.HumanTeamID, Board: r.board, Teams: len(r.draft.State.DraftOrder),
			Keepers: mock.KeepersOf(r.settings.League), Seed: r.seed,
		})
		if err != nil {
			return apitypes.RoomCard{}, err
		}
		if err := s.Mocks.PutCard(ctx, id, pick, draftroom.Trim(c, r.draft.State)); err != nil {
			return apitypes.RoomCard{}, err
		}
		// Two tabs asking at once: the first card written is the one both see.
		if raw, _, err = s.Mocks.Card(ctx, id, pick); err != nil {
			return apitypes.RoomCard{}, err
		}
	}
	var c advisor.Card
	if err := json.Unmarshal(raw, &c); err != nil {
		return apitypes.RoomCard{}, fmt.Errorf("solo: decode card %s at %d: %w", id, pick, err)
	}
	return draftroom.CardView(c, pick, false), nil
}

// report is the finished draft's report, from the cache or computed once.
func (s *Service) report(ctx context.Context, accountID, id uuid.UUID) (json.RawMessage, error) {
	if raw, ok, err := s.Mocks.Report(ctx, accountID, id); err != nil || ok {
		return raw, err
	}
	r, err := s.load(ctx, accountID, id)
	if err != nil {
		return nil, err
	}
	if !draft.IsComplete(r.draft.State) {
		return nil, errNotFinished
	}
	out, err := draftroom.Report(ctx, draftroom.ReportInput{
		Settings: r.settings, Seed: r.seed, Draft: r.draft, Board: r.board, Odds: s.Hindsight,
		Runs: sim.RoomOddsRuns, Workers: s.ReportWorkers,
	})
	if err != nil {
		return nil, err
	}
	if err := s.Mocks.PutReport(ctx, accountID, id, r.head, out, s.Now()); err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

// start makes a new mock: every bot pick before the drafter's first turn
// is in its log from the start.
func (s *Service) start(ctx context.Context, accountID uuid.UUID, leagueID *uuid.UUID, league apitypes.LeagueSettings, seed int64) (room, error) {
	league = leagues.Normalize(league)
	board, err := s.Boards.For(ctx, league)
	if err != nil {
		return room{}, err
	}
	at := s.now()
	settings := mock.Settings{League: league, Pool: board.Pool(), StartedAt: stamp(at)}
	d, err := mock.Run(settings, uint32(seed), nil, mock.Options{})
	if err != nil {
		return room{}, err
	}
	entries, err := mock.LogEntries(d, 1)
	if err != nil {
		return room{}, err
	}
	m, err := s.Mocks.Start(ctx, accountID, mocks.NewMock{
		ID: uuid.New(), LeagueID: leagueID, Settings: league, Seed: seed, CreatedAt: at, Actions: entries,
	})
	if err != nil {
		return room{}, err
	}
	return room{mock: m, settings: settings, seed: uint32(seed), board: board, draft: d, head: int64(len(entries))}, nil
}

// replay is a shared draft, rebuilt from its link.
func (s *Service) replay(ctx context.Context, code string) (room, error) {
	sh, err := decodeShare(code)
	if err != nil {
		return room{}, err
	}
	if errs := leagues.Validate(sh.Settings, ""); errs != nil {
		return room{}, errBadCode
	}
	league := leagues.Normalize(sh.Settings)
	board, err := s.Boards.For(ctx, league)
	if err != nil {
		return room{}, err
	}
	settings := mock.Settings{League: league, Pool: board.Pool(), StartedAt: sharedEpoch}
	picks := make([]mock.HumanPick, len(sh.Picks))
	for i, id := range sh.Picks {
		picks[i] = mock.HumanPick{PlayerID: id}
	}
	d, err := mock.Run(settings, uint32(sh.Seed), picks, mock.Options{})
	if err != nil {
		return room{}, err
	}
	created, _ := time.Parse(time.RFC3339, sharedEpoch)
	status := apitypes.MockStatusActive
	if draft.IsComplete(d.State) {
		status = apitypes.MockStatusComplete
	}
	m := apitypes.Mock{Settings: league, Seed: sh.Seed, Status: status, CreatedAt: created}
	return room{mock: m, settings: settings, seed: uint32(sh.Seed), board: board, draft: d}, nil
}

// sharedReport is a shared draft's report; the hindsight is the
// engine's, since a link records no odds.
func (s *Service) sharedReport(ctx context.Context, code string) (apitypes.MockReport, error) {
	if out, ok := s.shared.get(code); ok {
		return out, nil
	}
	r, err := s.replay(ctx, code)
	if err != nil {
		return apitypes.MockReport{}, err
	}
	if !draft.IsComplete(r.draft.State) {
		return apitypes.MockReport{}, errNotFinished
	}
	out, err := draftroom.Report(ctx, draftroom.ReportInput{
		Settings: r.settings, Seed: r.seed, Draft: r.draft, Board: r.board, Odds: s.Hindsight,
		Runs: sim.RoomOddsRuns, Workers: s.ReportWorkers,
	})
	if err != nil {
		return apitypes.MockReport{}, err
	}
	s.shared.put(code, out)
	return out, nil
}
