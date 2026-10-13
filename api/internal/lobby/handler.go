package lobby

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// Rate limits: the lobby list is polled by the setup page, a card is read
// at every pick of a 30 second clock, a report runs 200 drafts.
const (
	limitListPerMinute   = 120
	limitJoinPerMinute   = 20
	limitReadPerMinute   = 240
	limitReportPerMinute = 30
)

// Handles reads an account's lobby name. *auth.Store implements it.
type Handles interface {
	HandleOf(ctx context.Context, id uuid.UUID) (*string, error)
}

// Handler is the lobby's request API: the queue, the room's view, the
// card and the report. Picks and the clock are the room service's.
type Handler struct {
	Store   *Store
	Boards  *draftroom.Boards
	Advisor advisor.Advisor
	// Engine answers the card off your turn, which only the room's own
	// runs can: the advisor reads a seat on the clock.
	Engine    advisor.Engine
	Hindsight mock.Odds
	Workers   int
	Handles   Handles
	// RoomBaseURL is the room service's WebSocket origin.
	RoomBaseURL string
	Log         *slog.Logger

	cards   memo[apitypes.RoomCard]
	reports memo[apitypes.MockReport]
}

// Routes is every route the lobby serves from the api.
func (h *Handler) Routes() []httpx.Route {
	in, perMin := httpx.SignedIn, httpx.PerMinute
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/lobbies", Access: httpx.Public, Limit: perMin(limitListPerMinute), Handler: h.list},
		{Method: http.MethodPost, Path: "/lobbies/join", Access: in, Limit: perMin(limitJoinPerMinute), Handler: h.join},
		{Method: http.MethodGet, Path: "/lobbies/{id}", Access: in, Limit: perMin(limitReadPerMinute), Handler: h.get},
		{Method: http.MethodPost, Path: "/lobbies/{id}/leave", Access: in, Limit: perMin(limitJoinPerMinute), Handler: h.leave},
		{Method: http.MethodGet, Path: "/lobbies/{id}/card", Access: in, Limit: perMin(limitReadPerMinute), Handler: h.card},
		{Method: http.MethodGet, Path: "/lobbies/{id}/report", Access: in, Limit: perMin(limitReportPerMinute), Handler: h.report},
	}
}

// SocketURL is a room's WebSocket.
func (h *Handler) SocketURL(id uuid.UUID) string {
	return h.RoomBaseURL + "/rooms/" + id.String() + "/ws"
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, op string, err error) {
	var refusal *draft.Refusal
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteNotFound(w, r)
	case errors.Is(err, ErrNoSeat):
		httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeForbidden, "You do not have a seat in this room", nil)
	case errors.As(err, &refusal):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, refusal.Reason, nil)
	default:
		httpx.WriteInternal(w, r, h.Log, op, err)
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	filling, err := h.Store.Filling(r.Context())
	if err != nil {
		h.fail(w, r, "lobby: list", err)
		return
	}
	out := make([]apitypes.LobbyFilling, 0, len(Formats()))
	for _, f := range Formats() {
		out = append(out, apitypes.LobbyFilling{
			Format: f.Key, Teams: f.Teams, ClockSeconds: f.ClockSeconds, Scoring: f.Scoring, Lineup: f.Lineup, Filling: filling[f.Key],
		})
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	var in apitypes.LobbyJoin
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	f, ok := FormatOf(in.Format)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{"format": "Pick one of the lobbies"})
		return
	}
	account := auth.AccountID(r)
	handle, err := h.Handles.HandleOf(r.Context(), account)
	if err != nil {
		h.fail(w, r, "lobby: handle", err)
		return
	}
	// Strangers see each other's handles, so a lobby needs one, and the
	// account layer's filter has already passed it.
	if handle == nil {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "Pick a handle to draft with people",
			map[string]string{"handle": "Pick a handle first"})
		return
	}
	id, seat, err := h.Store.Join(r.Context(), account, *handle, f)
	if err != nil {
		h.fail(w, r, "lobby: join", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.LobbySeat{RoomId: id, Seat: seat, SocketUrl: h.SocketURL(id)})
}

// seated loads a room and the caller's seat in it.
func (h *Handler) seated(ctx context.Context, r *http.Request) (*Room, int, error) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		return nil, 0, ErrNotFound
	}
	room, err := h.Store.Load(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	seat := room.SeatOf(auth.AccountID(r))
	if seat == 0 {
		return nil, 0, ErrNoSeat
	}
	return room, seat, nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	room, seat, err := h.seated(r.Context(), r)
	if err != nil {
		h.fail(w, r, "lobby: get", err)
		return
	}
	board, err := h.Boards.For(r.Context(), room.Settings)
	if err != nil {
		h.fail(w, r, "lobby: board", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.LobbyRoom{
		Id: room.ID, Format: room.Format.Key, Status: apitypes.LobbyRoomStatus(room.Status), Teams: room.Format.Teams,
		Rounds: leagues.Rounds(room.Settings), ClockSeconds: room.Format.ClockSeconds, FillDeadline: room.FillDeadline,
		StartedAt: room.StartedAt, SoloPace: room.SoloPace, You: seat, Settings: room.Settings, Seats: seatsView(room),
		Board: draftroom.BoardView(board, nil), SocketUrl: h.SocketURL(room.ID),
	})
}

func seatsView(room *Room) []apitypes.LobbySeatView {
	out := make([]apitypes.LobbySeatView, 0, room.Format.Teams)
	for n := 1; n <= room.Format.Teams; n++ {
		s, ok := room.Seats[n]
		v := apitypes.LobbySeatView{Seat: n, Handle: s.Handle, Kind: apitypes.LobbySeatViewKindOpen}
		switch {
		case !ok:
		case s.IsBot:
			v.Kind = apitypes.LobbySeatViewKindBot
		case s.Left():
			v.Kind = apitypes.LobbySeatViewKindLeft
		default:
			v.Kind = apitypes.LobbySeatViewKindDrafter
		}
		out = append(out, v)
	}
	return out
}

func (h *Handler) leave(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.Store.Leave(r.Context(), id, auth.AccountID(r)); err != nil {
		h.fail(w, r, "lobby: leave", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

// card is our call for the caller's seat: the advisor's on the clock, and
// off it the engine's call if the board holds to the caller's pick.
func (h *Handler) card(w http.ResponseWriter, r *http.Request) {
	room, seat, err := h.seated(r.Context(), r)
	if err != nil {
		h.fail(w, r, "lobby: card", err)
		return
	}
	if room.Status != StatusDrafting {
		h.fail(w, r, "lobby: card", ErrNotDrafting)
		return
	}
	key := memoKey{room: room.ID, seq: room.Seq, seat: seat}
	if out, ok := h.cards.get(key); ok {
		httpx.WriteOK(w, r, http.StatusOK, out)
		return
	}
	board, err := h.Boards.For(r.Context(), room.Settings)
	if err != nil {
		h.fail(w, r, "lobby: board", err)
		return
	}
	team := TeamID(seat)
	req := advisor.Request{State: room.State, TeamID: team, Board: board, Teams: room.Format.Teams, Seed: room.Seed}
	var out apitypes.RoomCard
	if onClock, ok := draft.TeamOnClock(room.State); ok && onClock == team {
		c, err := h.onClockCard(r.Context(), room, req)
		if err != nil {
			h.fail(w, r, "lobby: card", err)
			return
		}
		out = draftroom.CardView(c, room.State.PickNumber, false)
	} else {
		c, err := h.Engine.Conditional(r.Context(), req)
		if err != nil {
			h.fail(w, r, "lobby: card", err)
			return
		}
		out = draftroom.CardView(draftroom.Trim(c, room.State), *c.NextPick, true)
	}
	h.cards.put(key, out)
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// onClockCard is the card for the seat on the clock, computed once and
// stored, so the pick that follows records the odds this drafter saw.
func (h *Handler) onClockCard(ctx context.Context, room *Room, req advisor.Request) (advisor.Card, error) {
	pick := room.State.PickNumber
	if c, ok, err := h.Store.Card(ctx, room.ID, pick); err != nil || ok {
		return c, err
	}
	c, err := h.Advisor.Card(ctx, req)
	if err != nil {
		return advisor.Card{}, err
	}
	if err := h.Store.PutCard(ctx, room.ID, pick, draftroom.Trim(c, room.State)); err != nil {
		return advisor.Card{}, err
	}
	// Two tabs asking at once: the first card written is the one both see.
	stored, _, err := h.Store.Card(ctx, room.ID, pick)
	return stored, err
}

// report is the finished room's report for the caller's seat. Its
// hindsight reads the odds each pick recorded (the on-clock card); a
// pick made with no card read falls back to the engine's runs.
func (h *Handler) report(w http.ResponseWriter, r *http.Request) {
	room, seat, err := h.seated(r.Context(), r)
	if err != nil {
		h.fail(w, r, "lobby: report", err)
		return
	}
	if room.Status != StatusComplete {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "The report is ready when the draft is over.", nil)
		return
	}
	key := memoKey{room: room.ID, seq: room.Seq, seat: seat}
	if out, ok := h.reports.get(key); ok {
		httpx.WriteOK(w, r, http.StatusOK, out)
		return
	}
	board, err := h.Boards.For(r.Context(), room.Settings)
	if err != nil {
		h.fail(w, r, "lobby: board", err)
		return
	}
	out, err := draftroom.Report(r.Context(), draftroom.ReportInput{
		Settings: mock.Settings{League: room.Settings, Pool: board.Pool(), StartedAt: room.Config.KickoffAt},
		Seed:     room.Seed, Board: board, Odds: h.Hindsight, Runs: sim.RoomOddsRuns, Workers: h.Workers,
		Draft: mock.Draft{Config: room.Config, Actions: room.Actions, State: room.State, HumanTeamID: TeamID(seat), Slot: seat, Odds: room.Odds, By: room.By},
	})
	if err != nil {
		h.fail(w, r, "lobby: report", err)
		return
	}
	h.reports.put(key, out)
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// memoKey is one seat's view of a room at one seq.
type memoKey struct {
	room uuid.UUID
	seq  int64
	seat int
}

// maxMemo bounds a memo; past it the memo starts over.
const maxMemo = 512

// memo keeps answers that depend only on a room's seq and a seat: twelve
// drafters asking at once cost one computation each.
type memo[T any] struct {
	mu      sync.Mutex
	entries map[memoKey]T
}

func (m *memo[T]) get(k memoKey) (T, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.entries[k]
	return v, ok
}

func (m *memo[T]) put(k memoKey, v T) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil || len(m.entries) >= maxMemo {
		m.entries = map[memoKey]T{}
	}
	m.entries[k] = v
}
