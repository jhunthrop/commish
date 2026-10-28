// Package inseason is the in-season tools' API (spec 2026-10-15 §7):
// start and sit, waivers and the trade finder for the drafter's own
// attached league. Each reads the league as the sync route does, our
// board valued for the league, the league's saved scoring and roster,
// and the research store's 2026 stat lines, schedule and injury
// captures. Nothing is projected for a week, and nothing here writes a
// host: the lineup says when the member may set it from our screen
// (package hostmoves makes the move).
package inseason

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"sync/atomic"
)

// limitPerMinute is the sync routes' read limit, per account: a page
// reads once on load and once a minute while open.
const limitPerMinute = 120

// maxPlayerParam bounds ?player=, a board id.
const maxPlayerParam = 64

// maxRosterParam bounds ?roster=, a roster id's digits.
const maxRosterParam = 9

// Leagues answers the account's followed league for a request, or
// answers the request itself and reports false.
type Leagues interface {
	Follow(w http.ResponseWriter, r *http.Request) (League, bool)
}

// SeasonFacts is the season's facts and a week's published projection.
// *Cache implements it.
type SeasonFacts interface {
	Data(ctx context.Context, season int) (Data, error)
	Projection(ctx context.Context, season, week int) (boards.WeekProjection, error)
}

// Holds is the board ids an account tags Hold. *sheets.Store implements it.
type Holds interface {
	Held(ctx context.Context, accountID uuid.UUID) (map[string]bool, error)
}

// Moves says whether the account may set its lineup, or claim, on the
// host from our screen. *hostmoves.Service implements it; nil, the verb
// is always the host's page.
type Moves interface {
	LineupMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.LineupMoves, error)
	ClaimMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.WaiverMoves, error)
}

// Service serves the three pages and the trade check.
type Service struct {
	Leagues Leagues
	// Landings is every account's league for a read that just landed, so
	// the trade search is warmed then (warm.go); nil warms nothing.
	Landings Landings
	Facts    SeasonFacts
	Holds    Holds
	Moves    Moves
	// Offers is the platform offers kept for each attachment, answered on
	// the trade finder (Lane 279); nil answers none.
	Offers Offers
	// Weeks lists the account's leagues for GET /me/week, nil answers none.
	Weeks Weeks
	// Records grades the account's league for GET /leagues/attached/{id}/record (Lane
	// 93); nil answers its lineup with no weeks.
	Records Records
	// Boards values our board for the reads with no league: the public player read and the public
	// order (PublicSettings).
	Boards BoardSource
	// Lives keeps each board at the read's clock for the minute, built
	// once for every route that reads it (Lane 112); nil builds it per
	// request.
	Lives *LiveBoards
	// Context is main's: shutdown stops every trade search and warm run
	// (rereview 66u W3); nil is context.Background.
	Context context.Context
	// finds keeps each pair's latest trade search (targets.go), for
	// /trades, the order's targets and a landed read's warm run alike.
	finds readCache[map[int][]Trade]
	// SearchTimeout bounds one trade search, searchTimeout when zero.
	SearchTimeout time.Duration
	// searches counts the trade searches run, the cache's misses.
	searches atomic.Int64
	// beforeSearch, set by a test, runs as a search starts.
	beforeSearch func()
	// viewers is who viewed each league lately: the warm run's accounts.
	viewers viewerSet
	// warms is the landed reads waiting for a warm worker.
	warms warmQueue
	// Season is the season GET /games/week reads, the board's.
	Season int
	Now    func() time.Time
	Log    *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	limit := httpx.PerMinute(limitPerMinute)
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/lineup", Access: httpx.SignedIn, Limit: limit, Handler: s.lineup},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/matchup", Access: httpx.SignedIn, Limit: limit, Handler: s.matchup},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/scoreboard", Access: httpx.SignedIn, Limit: limit, Handler: s.scoreboard},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/record", Access: httpx.SignedIn, Limit: limit, Handler: s.leagueRecord},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/waivers", Access: httpx.SignedIn, Limit: limit, Handler: s.waivers},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/trades", Access: httpx.SignedIn, Limit: limit, Handler: s.trades},
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/trades/check", Access: httpx.SignedIn, Limit: limit, Handler: s.checkTrade},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/order", Access: httpx.SignedIn, Limit: limit, Handler: s.leagueOrder},
		{Method: http.MethodGet, Path: "/order", Access: httpx.Public, Limit: limit, Handler: s.publicOrder},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/order/week", Access: httpx.SignedIn, Limit: limit, Handler: s.leagueWeekOrder},
		{Method: http.MethodGet, Path: "/order/week", Access: httpx.Public, Limit: limit, Handler: s.publicWeekOrder},
		{Method: http.MethodGet, Path: "/games/week", Access: httpx.Public, Limit: limit, Handler: s.weekGames},
		{Method: http.MethodGet, Path: "/me/week", Access: httpx.SignedIn, Limit: limit, Handler: s.week},
		{Method: http.MethodGet, Path: "/players/{player}/week", Access: httpx.Public, Limit: limit, Handler: s.playerWeek},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/players/{player}", Access: httpx.SignedIn, Limit: limit, Handler: s.leaguePlayerWeek},
	}
}

// Field names and the drafter's words for them.
const (
	fieldPosition = "position"
	fieldPlayer   = "player"
	positionWords = "Pick a position: QB, RB, WR, TE, K or DEF"
	playerWords   = "That player is not on a roster in this league"
	noTeamWords   = "We could not find your team in this league's last read"
	// fieldGameRoster is the Matchup's ?roster=, a roster id (Lane 204); the
	// Order's ?roster= (fieldRoster) is a roster mark, another field.
	fieldGameRoster = "roster"
	// gameRosterWords is ?roster= naming no team of the league's last read
	// (404); notRosterWords is one that is not a roster id at all (400).
	gameRosterWords = "That team is not in this league's last read"
	notRosterWords  = "Pick a team from the scoreboard"
)

// screenWeek is the week a screen's advisor reads (Lane 95).
type screenWeek int

const (
	// leagueWeek is the platform's week: the Lineup, the Matchup and every
	// screen about the week's games.
	leagueWeek screenWeek = iota
	// actionWeek is the first week the member can still act on
	// (advisor.addressedWeek): Waivers and Trades.
	actionWeek
)

// advisorFor is the request's league with its facts on the platform's
// week (advisorAt).
func (s *Service) advisorFor(w http.ResponseWriter, r *http.Request) (*advisor, bool) {
	return s.advisorAt(w, r, leagueWeek)
}

// advisorAt is the request's league with its facts for the screen's week,
// or an answer: a league with no saved scoring answers 422 naming why, a
// league with no current week 409 in the league page's words. A stale host
// read is no error: read_at says how stale.
func (s *Service) advisorAt(w http.ResponseWriter, r *http.Request, at screenWeek) (*advisor, bool) {
	l, ok := s.Leagues.Follow(w, r)
	if !ok {
		return nil, false
	}
	if l.Saved == nil {
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, l.SettingsNote, nil)
		return nil, false
	}
	if l.Snap.Week == 0 {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, leaguesync.NoGamesWords, nil)
		return nil, false
	}
	account := auth.AccountID(r)
	s.viewers.saw(l.Snap.Ref, account, s.Now())
	a, err := s.leagueAdvisor(r.Context(), l, account, context.WithoutCancel(s.base()), at)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: advisor", err)
		return nil, false
	}
	return a, true
}

// SearchStoppedWords is the sentence a screen prints when the trade
// search stopped before it finished (shutdown, its deadline): never an
// empty table (rereview 66u F2).
const SearchStoppedWords = "We could not finish the trade search just now. Try again in a moment."

// searchStopped answers a request whose trade search stopped, 503 with
// SearchStoppedWords, logging it once; false when the search finished.
func (s *Service) searchStopped(w http.ResponseWriter, r *http.Request, a *advisor) bool {
	if a.searchErr == nil {
		return false
	}
	s.Log.Warn("inseason: the trade search stopped", "league", a.Snap.Ref.Key(), "err", a.searchErr)
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, SearchStoppedWords, nil)
	return true
}

// leagueAdvisor is the account's league with its facts, the week's
// projection, its holds and the pair's kept trade search: what a request
// reads, and what a landed read warms (warm.go). search is the context a
// search it starts runs on: the service's for a request (requests share
// it), the warm run's for a warm. at is the screen's week: on actionWeek
// the advisor turns to the week after once the member's lineup has played
// its week (Lane 95).
func (s *Service) leagueAdvisor(ctx context.Context, l League, account uuid.UUID, search context.Context, at screenWeek) (*advisor, error) {
	data, err := s.Facts.Data(ctx, seasonOf(l))
	if err != nil {
		return nil, fmt.Errorf("facts: %w", err)
	}
	held, err := s.Holds.Held(ctx, account)
	if err != nil {
		return nil, fmt.Errorf("held: %w", err)
	}
	a, err := newAdvisor(l, data, s.projection(ctx, seasonOf(l), l.Snap.Week), held, s.Now(), s.Lives)
	if err != nil {
		return nil, err
	}
	if at == actionWeek {
		a = s.addressed(ctx, a)
	}
	a.finds = s.findsFor(a, account.String(), search)
	return a, nil
}

// addressed is the advisor for the week an action screen addresses: a
// itself on its own week, else a turned to the week after with that week's
// published projection (Lane 95).
func (s *Service) addressed(ctx context.Context, a *advisor) *advisor {
	week := a.addressedWeek()
	if week == a.week {
		return a
	}
	return a.turnTo(week, s.projection(ctx, seasonOf(a.League), week))
}

// projection is the week's published projection. A read that fails is
// logged and the rows answer without it: the column says "--", the page
// still answers.
func (s *Service) projection(ctx context.Context, season, week int) boards.WeekProjection {
	p, err := s.Facts.Projection(ctx, season, week)
	if err != nil {
		s.Log.Warn("inseason: the week's projection was not read; the rows answer without it", "week", week, "err", err)
		return boards.WeekProjection{Week: week}
	}
	return p
}

// seasonOf is the season whose facts the league's week reads: the
// league's own, else the board's.
func seasonOf(l League) int {
	if l.Snap.Season > 0 {
		return l.Snap.Season
	}
	return l.Board.Raw.Season
}

func (s *Service) lineup(w http.ResponseWriter, r *http.Request) {
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out, ok := a.Lineup()
	if ok && s.Moves != nil {
		// A failed check fails closed: the verb is the host's page, and
		// start and sit still answers.
		out.Moves = s.lineupMoves(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
	}
	s.answer(w, r, out, ok)
}

// matchup is the week's matchup as a box score: the member's game, or
// with ?roster= the game of the roster it names (Lane 204). A roster that
// is not a whole number answers 400 before the league is read; one the
// league's last read does not list answers 404, each naming the field.
func (s *Service) matchup(w http.ResponseWriter, r *http.Request) {
	asked, ok := rosterParam(r)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{fieldGameRoster: notRosterWords})
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	roster := a.Me
	if asked != nil {
		if _, listed := a.Snap.TeamByRoster(*asked); !listed {
			httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, gameRosterWords, map[string]string{fieldGameRoster: gameRosterWords})
			return
		}
		roster = *asked
	}
	out, ok := a.Matchup(roster)
	s.answer(w, r, out, ok)
}

// rosterParam is ?roster=, nil when absent; false when it is not a whole
// number a roster id can be.
func rosterParam(r *http.Request) (*int, bool) {
	q := r.URL.Query()
	if !q.Has(fieldGameRoster) {
		return nil, true
	}
	text := q.Get(fieldGameRoster)
	if len(text) > maxRosterParam {
		return nil, false
	}
	// Digits only: ParseUint takes no sign, so "+1" is refused as the schema refuses it (review L1).
	n, err := strconv.ParseUint(text, 10, 31)
	if err != nil {
		return nil, false
	}
	roster := int(n)
	return &roster, true
}

func (s *Service) scoreboard(w http.ResponseWriter, r *http.Request) {
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	s.answer(w, r, a.Scoreboard(), true)
}

func (s *Service) waivers(w http.ResponseWriter, r *http.Request) {
	position := draft.Position(r.URL.Query().Get(fieldPosition))
	if position != "" && !position.Valid() {
		httpx.WriteInvalid(w, r, map[string]string{fieldPosition: positionWords})
		return
	}
	asked := r.URL.Query().Get(fieldPlayer)
	if len(asked) > maxPlayerParam {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	a, ok := s.advisorAt(w, r, actionWeek)
	if !ok {
		return
	}
	out, ok := a.Waivers(position, asked)
	if ok && s.Moves != nil {
		// A failed check fails closed, as the lineup's does.
		moves, err := s.Moves.ClaimMove(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
		if err != nil {
			// What the check knew before it failed is kept, the claim closed,
			// and the line always set, as the lineup's (review 66f M2).
			s.Log.Warn("inseason: claim moves", "err", err)
			moves.Claim = apitypes.WaiverMovesClaimUnavailable
			if moves.Reason == nil {
				moves.Reason = CopyOnlyClaims(a.Snap.Ref.Host).Reason
			}
		}
		out.Moves = moves
	}
	s.answer(w, r, out, ok)
}

func (s *Service) trades(w http.ResponseWriter, r *http.Request) {
	player := r.URL.Query().Get(fieldPlayer)
	if len(player) > maxPlayerParam {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	a, ok := s.advisorAt(w, r, actionWeek)
	if !ok {
		return
	}
	focus := ""
	if player != "" {
		if focus = a.hostIDOf(player); focus == "" {
			httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
			return
		}
	}
	out, ok := a.Trades(focus)
	if s.searchStopped(w, r, a) {
		return
	}
	if ok {
		out.Offers = s.offersFor(r.Context(), auth.AccountID(r), a.League, s.Now())
	}
	s.answer(w, r, out, ok)
}

// checkTrade answers one trade the drafter built (the trade builder):
// the body checked before the league is read, a team or player the read
// does not hold as asked refused in a sentence naming him.
func (s *Service) checkTrade(w http.ResponseWriter, r *http.Request) {
	var in apitypes.TradeCheckInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if fields := checkFields(in); len(fields) > 0 {
		httpx.WriteInvalid(w, r, fields)
		return
	}
	a, ok := s.advisorAt(w, r, actionWeek)
	if !ok {
		return
	}
	out, refused, ok := a.CheckTrade(in)
	if refused != nil {
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refused.sentence,
			map[string]string{refused.field: refused.sentence})
		return
	}
	s.answer(w, r, out, ok)
}

// answer writes a page, or says the drafter's team is not in the read.
func (s *Service) answer(w http.ResponseWriter, r *http.Request, out any, ok bool) {
	if !ok {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeTeamNotRead, noTeamWords, nil)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// SyncLeagues is league sync as the routes' Leagues: the sync route's
// read of the account's league.
type SyncLeagues struct{ Sync *leaguesync.Service }

// Follow is the account's league, or the sync route's answer.
func (l SyncLeagues) Follow(w http.ResponseWriter, r *http.Request) (League, bool) {
	f, ok := l.Sync.Follow(w, r)
	if !ok {
		return League{}, false
	}
	return leagueOf(f), true
}

// leagueOf is a followed league as the advice reads it.
func leagueOf(f leaguesync.Followed) League {
	out := League{Snap: f.Snap, LinkID: f.Link.ID, Me: f.Link.RosterID, Saved: f.Saved, Board: f.Board, HeldBy: f.HeldBy, Player: f.Player}
	if f.Saved == nil {
		out.SettingsNote = f.SettingsNote()
	}
	return out
}
