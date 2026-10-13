// Package rooms is the room service's runtime (spec §2.2): the WebSocket
// each drafter holds on a lobby, the hub that carries every write to a
// room's log to every socket and clock on it, and the owners that keep
// each live room's clock under a lease a sweep adopts when an instance
// dies. The room's state is its log (internal/lobby): a client that drops
// reconnects by room id and the last seq it applied and loses nothing.
package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/lobby"
)

// Socket timings. The hello must arrive promptly; pings keep the
// connection alive through Cloud Run's front end and find a dead peer
// well inside a 30 second pick clock, so its seat goes to a stand-in
// before the clock would have.
const (
	helloTimeout   = 10 * time.Second
	pingEvery      = 10 * time.Second
	pingTimeout    = 5 * time.Second
	writeTimeout   = 5 * time.Second
	commandTimeout = 5 * time.Second
	maxMessage     = 8 << 10
)

// limitConnectPerMinute bounds how often one drafter opens a socket.
const limitConnectPerMinute = 30

// Socket serves GET /rooms/{id}/ws.
type Socket struct {
	Lobby *lobby.Store
	Hub   *Hub
	// OriginHosts are the hosts a browser may open a socket from, the
	// same origins CORS allows.
	OriginHosts []string
	Now         func() time.Time
	Log         *slog.Logger

	presence presence
}

// OriginHosts turns exact origins into the host patterns the WebSocket
// library checks.
func OriginHosts(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			out = append(out, u.Host)
		}
	}
	return out
}

// Routes is every route this package serves.
func (s *Socket) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/rooms/{id}/ws", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitConnectPerMinute), Handler: s.serve},
	}
}

func (s *Socket) serve(w http.ResponseWriter, r *http.Request) {
	roomID, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	account := auth.AccountID(r)
	if !s.admit(w, r, roomID, account) {
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.OriginHosts})
	if err != nil {
		// Accept has already answered the request.
		s.Log.Warn("rooms: accept", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		return
	}
	conn.SetReadLimit(maxMessage)
	defer func() { _ = conn.CloseNow() }()
	if err := s.session(r.Context(), conn, roomID, account); err != nil && !isClosed(err) {
		s.Log.Warn("rooms: session", "request_id", httpx.RequestIDFrom(r.Context()), "room", roomID, "err", err)
	}
}

// admit is the socket's authorization rule: a room's log is read only by
// an account that holds a seat in it, now or before it left (a drafter
// who closed the tab comes back to the draft they were part of). A
// missing room answers 404, a room the caller has no seat in 403, and in
// either case nothing is sent.
func (s *Socket) admit(w http.ResponseWriter, r *http.Request, roomID, account uuid.UUID) bool {
	room, err := s.Lobby.Load(r.Context(), roomID)
	if errors.Is(err, lobby.ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "rooms: open", err)
		return false
	}
	if room.SeatOf(account) == 0 {
		httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeForbidden, "You do not have a seat in this room", nil)
		return false
	}
	return true
}

func isClosed(err error) bool {
	s := websocket.CloseStatus(err)
	return s == websocket.StatusNormalClosure || s == websocket.StatusGoingAway || errors.Is(err, context.Canceled)
}

func (s *Socket) send(ctx context.Context, conn *websocket.Conn, v any) error {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return wsjson.Write(ctx, conn, v)
}

// wire is the log's rows as the client reads them. START_DRAFT's pool is
// left off: the page holds the board, and the pool is most of the bytes.
func wire(rows []lobby.LogRow) []apitypes.RoomAction {
	out := make([]apitypes.RoomAction, 0, len(rows))
	for _, row := range rows {
		payload := map[string]any{}
		_ = json.Unmarshal(row.Payload, &payload)
		if row.Kind == string(draft.StartDraft) {
			if a, ok := payload["action"].(map[string]any); ok {
				delete(a, "pool")
			}
		}
		out = append(out, apitypes.RoomAction{Seq: row.Seq, Kind: row.Kind, Seat: row.Seat, Payload: payload, At: row.At})
	}
	return out
}

// session runs one socket: the hello names the last seq the client
// applied, the welcome carries everything after it, then every batch the
// room writes goes out in seq order while the client's commands come in.
// A drafter who left is given the seat back on connecting; the last
// socket of a drafter on this instance closing hands the seat to its
// stand-in at once.
func (s *Socket) session(ctx context.Context, conn *websocket.Conn, roomID, account uuid.UUID) error {
	helloCtx, cancel := context.WithTimeout(ctx, helloTimeout)
	var hello apitypes.RoomHello
	err := wsjson.Read(helloCtx, conn, &hello)
	cancel()
	if err != nil {
		return err
	}
	if hello.Type != apitypes.RoomHelloTypeHello || hello.LastSeq < 0 {
		_ = s.send(ctx, conn, apitypes.RoomError{Type: apitypes.RoomErrorTypeError, Code: httpx.CodeInvalid,
			Message: "The first message must be a hello with the last seq you applied"})
		return conn.Close(websocket.StatusPolicyViolation, "hello expected")
	}
	moved, unsubscribe := s.Hub.Subscribe(roomID)
	defer unsubscribe()
	s.presence.enter(roomID, account)
	defer func() {
		if s.presence.leave(roomID, account) {
			leaveCtx, cancel := context.WithTimeout(context.Background(), commandTimeout)
			defer cancel()
			if err := s.Lobby.Disconnect(leaveCtx, roomID, account); err != nil && !errors.Is(err, lobby.ErrNoSeat) {
				s.Log.Warn("rooms: leave on close", "room", roomID, "err", err)
			}
		}
	}()
	if err := s.Lobby.Return(ctx, roomID, account); err != nil && !errors.Is(err, lobby.ErrNoSeat) {
		return err
	}
	rows, err := s.Lobby.LogSince(ctx, roomID, hello.LastSeq)
	if err != nil {
		return err
	}
	sent := hello.LastSeq
	if len(rows) > 0 {
		sent = rows[len(rows)-1].Seq
	}
	if err := s.send(ctx, conn, apitypes.RoomWelcome{
		Type: apitypes.RoomWelcomeTypeWelcome, RoomId: roomID, Seq: sent, Now: s.Now().UTC(), Actions: wire(rows),
	}); err != nil {
		return err
	}
	commands := make(chan apitypes.RoomCommand)
	readErr := make(chan error, 1)
	go func() { readErr <- readCommands(ctx, conn, commands) }()
	ticker := time.NewTicker(pingEvery)
	defer ticker.Stop()
	for {
		select {
		case err := <-readErr:
			return err
		case cmd := <-commands:
			if err := s.command(ctx, conn, roomID, account, cmd); err != nil {
				return err
			}
		case <-moved:
			if sent, err = s.catchUp(ctx, conn, roomID, sent); err != nil {
				return err
			}
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return err
			}
			// A notification lost while the hub was reconnecting is caught
			// up here, at the latest one ping later.
			if sent, err = s.catchUp(ctx, conn, roomID, sent); err != nil {
				return err
			}
		}
	}
}

// catchUp sends every row after sent, returning the new last seq sent.
func (s *Socket) catchUp(ctx context.Context, conn *websocket.Conn, roomID uuid.UUID, sent int64) (int64, error) {
	rows, err := s.Lobby.LogSince(ctx, roomID, sent)
	if err != nil || len(rows) == 0 {
		return sent, err
	}
	last := rows[len(rows)-1].Seq
	return last, s.send(ctx, conn, apitypes.RoomUpdate{Type: apitypes.RoomUpdateTypeUpdate, Seq: last, Actions: wire(rows)})
}

func readCommands(ctx context.Context, conn *websocket.Conn, out chan<- apitypes.RoomCommand) error {
	for {
		var cmd apitypes.RoomCommand
		if err := wsjson.Read(ctx, conn, &cmd); err != nil {
			return err
		}
		select {
		case out <- cmd:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// command applies one of the client's commands; a refusal goes back to
// the client as an error frame and the socket stays open.
func (s *Socket) command(ctx context.Context, conn *websocket.Conn, roomID, account uuid.UUID, cmd apitypes.RoomCommand) error {
	cctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	var err error
	switch cmd.Type {
	case apitypes.RoomCommandTypePick:
		if cmd.PlayerId == nil || cmd.Pick == nil {
			err = &draft.Refusal{Reason: "A pick names the player and the pick on the clock."}
			break
		}
		err = s.Lobby.Pick(cctx, roomID, account, *cmd.PlayerId, *cmd.Pick)
	case apitypes.RoomCommandTypeQueue:
		var ids []string
		if cmd.PlayerIds != nil {
			ids = *cmd.PlayerIds
		}
		err = s.Lobby.Queue(cctx, roomID, account, ids)
	case apitypes.RoomCommandTypeLeave:
		err = s.Lobby.Leave(cctx, roomID, account)
	default:
		err = &draft.Refusal{Reason: "That is not a command the room knows."}
	}
	if err == nil {
		return nil
	}
	var refusal *draft.Refusal
	if errors.As(err, &refusal) || errors.Is(err, lobby.ErrNoSeat) {
		msg := "You do not have a seat in this room"
		if refusal != nil {
			msg = refusal.Reason
		}
		return s.send(ctx, conn, apitypes.RoomError{Type: apitypes.RoomErrorTypeError, Code: httpx.CodeConflict, Message: msg})
	}
	s.Log.Warn("rooms: command", "room", roomID, "type", cmd.Type, "err", err)
	return s.send(ctx, conn, apitypes.RoomError{Type: apitypes.RoomErrorTypeError, Code: httpx.CodeInternal, Message: "Something went wrong on our side"})
}

// presence counts each drafter's open sockets on this instance, so a
// second tab closing does not hand the seat to a stand-in.
type presence struct {
	mu   sync.Mutex
	open map[[2]uuid.UUID]int
}

func (p *presence) enter(room, account uuid.UUID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.open == nil {
		p.open = map[[2]uuid.UUID]int{}
	}
	p.open[[2]uuid.UUID{room, account}]++
}

// leave reports whether that was the drafter's last socket here.
func (p *presence) leave(room, account uuid.UUID) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	k := [2]uuid.UUID{room, account}
	p.open[k]--
	if p.open[k] > 0 {
		return false
	}
	delete(p.open, k)
	return true
}
