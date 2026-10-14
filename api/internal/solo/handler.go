package solo

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mocks"
)

// Rate limits. A pick is the room's heartbeat and costs a few
// milliseconds; the report and a shared replay run 200 drafts each.
const (
	limitCreatePerHour         = 120
	limitReadPerMinute         = 240
	limitPickPerMinute         = 600
	limitReportPerMinute       = 60
	limitSharedPerMinute       = 30
	limitSharedReportPerMinute = 10
)

// Routes is every route the solo room serves.
func (s *Service) Routes() []httpx.Route {
	in, perMin := httpx.Public, httpx.PerMinute
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/mocks", Access: in, Limit: httpx.PerHour(limitCreatePerHour), Handler: s.handleCreate},
		{Method: http.MethodGet, Path: "/mocks/{id}", Access: in, Limit: perMin(limitReadPerMinute), Handler: s.handleGet},
		{Method: http.MethodPost, Path: "/mocks/{id}/picks", Access: in, Limit: perMin(limitPickPerMinute), Handler: s.handlePick},
		{Method: http.MethodPost, Path: "/mocks/{id}/undo", Access: in, Limit: perMin(limitReadPerMinute), Handler: s.handleUndo},
		{Method: http.MethodPost, Path: "/mocks/{id}/autopick", Access: in, Limit: perMin(limitReadPerMinute), Handler: s.handleAutopick},
		{Method: http.MethodPost, Path: "/mocks/{id}/finish", Access: in, Limit: perMin(limitReadPerMinute), Handler: s.handleFinish},
		{Method: http.MethodPut, Path: "/mocks/{id}/queue", Access: in, Limit: perMin(limitPickPerMinute), Handler: s.handleQueue},
		{Method: http.MethodGet, Path: "/mocks/{id}/card", Access: in, Limit: perMin(limitPickPerMinute), Handler: s.handleCard},
		{Method: http.MethodGet, Path: "/mocks/{id}/report", Access: in, Limit: perMin(limitReportPerMinute), Handler: s.handleReport},
		{Method: http.MethodGet, Path: "/boards/{format}", Access: httpx.Public, Limit: perMin(limitReadPerMinute), Handler: s.handleBoard},
		{Method: http.MethodGet, Path: "/shared/mocks/{code}", Access: httpx.Public, Limit: perMin(limitSharedPerMinute), Handler: s.handleShared},
		{Method: http.MethodGet, Path: "/shared/mocks/{code}/report", Access: httpx.Public, Limit: perMin(limitSharedReportPerMinute), Handler: s.handleSharedReport},
	}
}

func randomSeed() int64 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return int64(binary.BigEndian.Uint32(b[:]))
}

// ownerAndID is the request's owner and the mock in its path. On false it
// has already answered.
func (s *Service) ownerAndID(w http.ResponseWriter, r *http.Request) (mocks.Owner, uuid.UUID, bool) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return mocks.Owner{}, uuid.Nil, false
	}
	owner, ok := s.owner(w, r)
	return owner, id, ok
}

// fail answers an error from the room in the envelope.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, op string, err error) {
	var refusal *draft.Refusal
	switch {
	case errors.Is(err, mocks.ErrNotFound):
		httpx.WriteNotFound(w, r)
	case errors.Is(err, mocks.ErrSeqConflict):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "The room moved on in another tab. Reload to see it.", nil)
	case errors.Is(err, errWrongPick):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "That pick has already been made.", nil)
	case errors.Is(err, errNotWaiting):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "The draft is not on you.", nil)
	case errors.Is(err, errNotFinished):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "Finish the draft to see its report.", nil)
	case errors.Is(err, errBadCode):
		httpx.WriteInvalid(w, r, map[string]string{"code": "That link does not hold a draft"})
	case errors.As(err, &refusal):
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refusal.Reason, nil)
	case errors.Is(err, boards.ErrCustomUnavailable):
		s.Log.Warn("solo: custom board", "op", op, "err", err)
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "Your league's scoring cannot be scored right now. Try again in a moment", nil)
	default:
		httpx.WriteInternal(w, r, s.Log, op, err)
	}
}

func (s *Service) answer(w http.ResponseWriter, r *http.Request, status int, rm room, withBoard bool) {
	out, err := view(rm, withBoard, s.Shares)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "solo: view", err)
		return
	}
	httpx.WriteOK(w, r, status, out)
}

// answerTurn is the room with the card for the turn it leaves on the
// drafter, so the turn and its call paint together rather than a second
// round trip apart. A card that cannot be made here is left off: the
// room still answers, and the page reads the card from /card.
func (s *Service) answerTurn(w http.ResponseWriter, r *http.Request, status int, rm room, withBoard bool) {
	out, err := view(rm, withBoard, s.Shares)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "solo: view", err)
		return
	}
	if rm.draft.Waiting {
		card, err := s.cardAt(r.Context(), rm)
		if err == nil {
			out.Card = &card
		} else {
			s.Log.Warn("solo: the turn answers without its card", "mock", rm.mock.Id, "pick", rm.draft.State.PickNumber, "err", err)
		}
	}
	httpx.WriteOK(w, r, status, out)
}

// settingsFor resolves a create's settings: a saved league's, or the
// ones in the request, never both. On false it has already answered.
func (s *Service) settingsFor(w http.ResponseWriter, r *http.Request, owner mocks.Owner, in apitypes.MockCreate) (apitypes.LeagueSettings, bool) {
	// A signed-out drafter has no saved leagues and no entitlements, so the
	// gate refuses custom scoring for them as for any account without it.
	accountID := owner.Account
	switch {
	case (in.LeagueId == nil) == (in.Settings == nil):
		httpx.WriteInvalid(w, r, map[string]string{"settings": "Start from a saved league or from settings, not both"})
		return apitypes.LeagueSettings{}, false
	case in.LeagueId != nil && owner.Anonymous():
		httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Sign in to start from a saved league", nil)
		return apitypes.LeagueSettings{}, false
	case in.LeagueId != nil:
		l, err := s.Leagues.Get(r.Context(), accountID, *in.LeagueId)
		if errors.Is(err, leagues.ErrNotFound) {
			httpx.WriteNotFound(w, r)
			return apitypes.LeagueSettings{}, false
		}
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "solo: read league", err)
			return apitypes.LeagueSettings{}, false
		}
		// A saved league passes the gate again: a custom scoring league
		// saved under a pass that has since ended cannot start a mock.
		return l.Settings, s.Gate.Check(w, r, accountID, l.Settings, "settings.")
	default:
		return *in.Settings, s.Gate.Check(w, r, accountID, *in.Settings, "settings.")
	}
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	var in apitypes.MockCreate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if in.Seed != nil && (*in.Seed < 0 || *in.Seed > maxSeed) {
		httpx.WriteInvalid(w, r, map[string]string{"seed": "The seed is a whole number from 0 to 4294967295"})
		return
	}
	// Who the request already is; a signed-out browser with no token gets
	// one only after the settings and the caps pass, so a refused create
	// never sets a cookie.
	owner, found, ok := s.current(w, r)
	if !ok {
		return
	}
	settings, ok := s.settingsFor(w, r, owner, in)
	if !ok {
		return
	}
	if owner.Anonymous() {
		if !s.admitAnonymous(w, r, owner, found) {
			return
		}
		if !found {
			if owner, ok = s.mint(w, r); !ok {
				return
			}
		}
	}
	seed := randomSeed()
	if in.Seed != nil {
		seed = *in.Seed
	}
	rm, err := s.start(r.Context(), owner, in.LeagueId, settings, seed)
	if err != nil {
		s.fail(w, r, "solo: create", err)
		return
	}
	s.answer(w, r, http.StatusCreated, rm, true)
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	rm, err := s.load(r.Context(), owner, id)
	if err != nil {
		s.fail(w, r, "solo: get", err)
		return
	}
	s.answerTurn(w, r, http.StatusOK, rm, true)
}

func (s *Service) handlePick(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	var in apitypes.MockPickInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if in.PlayerId == "" || in.Pick < 1 {
		httpx.WriteInvalid(w, r, map[string]string{"player_id": "Pick a player at the pick on the clock"})
		return
	}
	rm, err := s.pick(r.Context(), owner, id, in)
	if err != nil {
		s.fail(w, r, "solo: pick", err)
		return
	}
	s.answerTurn(w, r, http.StatusOK, rm, false)
}

func (s *Service) handleUndo(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	var in apitypes.MockUndoInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	rm, err := s.undo(r.Context(), owner, id, in.Pick)
	if err != nil {
		s.fail(w, r, "solo: undo", err)
		return
	}
	s.answerTurn(w, r, http.StatusOK, rm, false)
}

func (s *Service) handleAutopick(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	through, err := strconv.Atoi(r.URL.Query().Get("to_round"))
	if err != nil || through < 1 || through > leagues.MaxRounds {
		httpx.WriteInvalid(w, r, map[string]string{"to_round": "Pick a round in the draft"})
		return
	}
	s.autopickThrough(w, r, owner, id, through)
}

func (s *Service) handleFinish(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	s.autopickThrough(w, r, owner, id, leagues.MaxRounds)
}

func (s *Service) autopickThrough(w http.ResponseWriter, r *http.Request, owner mocks.Owner, id uuid.UUID, through int) {
	rm, err := s.autopick(r.Context(), owner, id, through)
	if err != nil {
		s.fail(w, r, "solo: autopick", err)
		return
	}
	s.answerTurn(w, r, http.StatusOK, rm, false)
}

func (s *Service) handleQueue(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	var in apitypes.MockQueueInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	rm, err := s.setQueue(r.Context(), owner, id, in.PlayerIds)
	if err != nil {
		s.fail(w, r, "solo: queue", err)
		return
	}
	s.answer(w, r, http.StatusOK, rm, false)
}

func (s *Service) handleCard(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	card, err := s.card(r.Context(), owner, id)
	if err != nil {
		s.fail(w, r, "solo: card", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, card)
}

func (s *Service) handleReport(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := s.ownerAndID(w, r)
	if !ok {
		return
	}
	raw, err := s.report(r.Context(), owner, id)
	if err != nil {
		s.fail(w, r, "solo: report", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, json.RawMessage(raw))
}

// standardTeams is the league the setup page's player list is valued for.
const standardTeams = 12

// boardPreset is the preset a board format reads as.
func boardPreset(format string) (apitypes.ScoringPreset, bool) {
	switch format {
	case "ppr":
		return apitypes.ScoringPresetPpr, true
	case "half":
		return apitypes.ScoringPresetHalfPpr, true
	case "std":
		return apitypes.ScoringPresetStandard, true
	}
	return "", false
}

func (s *Service) handleBoard(w http.ResponseWriter, r *http.Request) {
	preset, ok := boardPreset(r.PathValue("format"))
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{"format": "Pick ppr, half or std"})
		return
	}
	league := apitypes.LeagueSettings{
		Scoring: apitypes.Scoring{Preset: &preset}, Teams: standardTeams, Lineup: apitypes.LineupStandard,
		Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
		Keepers: []apitypes.Keeper{}, BotStyle: apitypes.BotStyleAdp,
	}
	b, err := s.Boards.For(r.Context(), league)
	if err != nil {
		s.fail(w, r, "solo: board", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, draftroom.BoardView(b, nil))
}

func (s *Service) handleShared(w http.ResponseWriter, r *http.Request) {
	rm, err := s.replay(r.Context(), r.PathValue("code"))
	if err != nil {
		s.fail(w, r, "solo: shared", err)
		return
	}
	s.answer(w, r, http.StatusOK, rm, true)
}

func (s *Service) handleSharedReport(w http.ResponseWriter, r *http.Request) {
	out, err := s.sharedReport(r.Context(), r.PathValue("code"))
	if err != nil {
		s.fail(w, r, "solo: shared report", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}
