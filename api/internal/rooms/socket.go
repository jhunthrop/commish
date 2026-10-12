package rooms

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Socket timings. The hello must arrive promptly; pings keep the
// connection alive through Cloud Run's front end and find dead peers.
const (
	helloTimeout = 10 * time.Second
	pingEvery    = 25 * time.Second
	pingTimeout  = 10 * time.Second
	writeTimeout = 5 * time.Second
	maxMessage   = 4 << 10
)

// limitConnect bounds how often one drafter opens a socket.
const limitConnectPerMinute = 30

// RoomReader is the part of Store the socket reads.
type RoomReader interface {
	Exists(ctx context.Context, roomID uuid.UUID) (bool, error)
	HoldsSeat(ctx context.Context, roomID, accountID uuid.UUID) (bool, error)
	ActionsSince(ctx context.Context, roomID uuid.UUID, afterSeq int64) (int64, []apitypes.RoomAction, error)
}

// Socket serves GET /rooms/{id}/ws.
type Socket struct {
	Rooms RoomReader
	// OriginHosts are the hosts a browser may open a socket from, the
	// same origins CORS allows.
	OriginHosts []string
	Log         *slog.Logger
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
	if !s.admit(w, r, roomID) {
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
	if err := s.session(r.Context(), conn, roomID); err != nil && !isClosed(err) {
		s.Log.Warn("rooms: session", "request_id", httpx.RequestIDFrom(r.Context()), "room", roomID, "err", err)
	}
}

// admit is the socket's authorization rule, the one the lobby lane
// builds on: a room's log is read only by an account that holds a seat
// in it (app.room_seats). A missing room answers 404, a room the caller
// has no seat in answers 403, and in either case no action is sent.
// Solo mocks never come here: the api serves them to their owner.
func (s *Socket) admit(w http.ResponseWriter, r *http.Request, roomID uuid.UUID) bool {
	exists, err := s.Rooms.Exists(r.Context(), roomID)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "rooms: open", err)
		return false
	}
	if !exists {
		httpx.WriteNotFound(w, r)
		return false
	}
	seated, err := s.Rooms.HoldsSeat(r.Context(), roomID, auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "rooms: seat", err)
		return false
	}
	if !seated {
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

// session runs the handshake: the client's hello names the last seq it
// applied, the welcome carries everything after it. The connection is
// then held open with pings until either side closes; Lane 6 streams
// new actions on it.
func (s *Socket) session(ctx context.Context, conn *websocket.Conn, roomID uuid.UUID) error {
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
	head, actions, err := s.Rooms.ActionsSince(ctx, roomID, hello.LastSeq)
	if err != nil {
		return err
	}
	if err := s.send(ctx, conn, apitypes.RoomWelcome{
		Type: apitypes.RoomWelcomeTypeWelcome, RoomId: roomID, Seq: head, Actions: actions,
	}); err != nil {
		return err
	}
	// Reads are drained in the background so control frames (pongs,
	// close) are processed; the room accepts no client messages yet.
	readCtx := conn.CloseRead(ctx)
	ticker := time.NewTicker(pingEvery)
	defer ticker.Stop()
	for {
		select {
		case <-readCtx.Done():
			return readCtx.Err()
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}
