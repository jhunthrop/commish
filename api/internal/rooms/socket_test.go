package rooms_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/devices"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/lobby"
	"github.com/jhunthrop/commish/api/internal/rooms"
	"github.com/jhunthrop/commish/api/internal/server"
)

const socketTestPassword = "a-room-socket-test-cookie-password-32+"

// testPingWait bounds a ping's wait for its pong in these tests; the
// heartbeat itself is ticked by hand (roomHarness.tick).
const testPingWait = 2 * time.Second

func socketNow() time.Time { return time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC) }

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// roomHarness is the room service's socket mounted as cmd/room mounts
// it, on a real database: alice holds a seat in the room, bob none.
type roomHarness struct {
	t        *testing.T
	pool     *pgxpool.Pool
	srv      *httptest.Server
	bearer   *auth.Bearer
	sessions *auth.Sessions
	accounts *auth.Store
	room     uuid.UUID
	ticks    chan time.Time
	alice    auth.Account
	bob      auth.Account
}

func newRoomHarness(t *testing.T) roomHarness {
	t.Helper()
	return newRoomHarnessWith(t, func(b *auth.Bearer) rooms.DeviceSessions { return b })
}

// newRoomHarnessWith mounts the room with the bearer as cmd/room does,
// the socket's re-read of a device token being devicesFor's.
func newRoomHarnessWith(t *testing.T, devicesFor func(*auth.Bearer) rooms.DeviceSessions) roomHarness {
	t.Helper()
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_bob", Email: "bob@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &lobby.Store{Pool: pool, Now: socketNow}
	format, ok := lobby.FormatOf(apitypes.LobbyFormatN12Ppr)
	if !ok {
		t.Fatal("no 12 PPR format")
	}
	room, _, err := store.Join(ctx, alice.ID, "alice", format)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := auth.NewSessions(config.Session{CookiePassword: socketTestPassword}, 0, accounts, socketNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	bearer, err := auth.NewBearer(socketTestPassword, 0, &devices.Store{Pool: pool}, socketNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	ticks := make(chan time.Time)
	heartbeat := func() (<-chan time.Time, func()) { return ticks, func() {} }
	socket := &rooms.Socket{Lobby: store, Hub: &rooms.Hub{Log: quietLog()}, Devices: devicesFor(bearer),
		Heartbeat: heartbeat, PingWait: testPingWait, Now: socketNow, Log: quietLog()}
	mux := http.NewServeMux()
	if err := server.Mount(mux, socket.Routes(), sessions, bearer, socketNow); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(httpx.RequestID()(mux))
	t.Cleanup(srv.Close)
	return roomHarness{t: t, pool: pool, srv: srv, bearer: bearer, sessions: sessions, accounts: accounts, room: room, ticks: ticks, alice: alice, bob: bob}
}

// pair inserts a device for the account with kind's scopes, created at
// created, and answers its token.
func (h roomHarness) pair(account uuid.UUID, kind auth.DeviceKind, created time.Time) (string, uuid.UUID) {
	h.t.Helper()
	token, hash := h.bearer.Mint()
	scopes := make([]string, 0, 3)
	for _, s := range auth.ScopesFor(kind) {
		scopes = append(scopes, string(s))
	}
	var id uuid.UUID
	if err := h.pool.QueryRow(context.Background(), `insert into app.devices (account_id, name, token_hash, scopes, kind, created_at)
		values ($1, 'a phone', $2, $3, $4, $5) returning id`, account, hash, scopes, string(kind), created).Scan(&id); err != nil {
		h.t.Fatal(err)
	}
	return token, id
}

// tick is one heartbeat, taken by the open socket's loop.
func (h roomHarness) tick() {
	h.t.Helper()
	select {
	case h.ticks <- socketNow():
	case <-time.After(5 * time.Second):
		h.t.Fatal("no socket took the tick")
	}
}

// command sends one command without reading.
func (h roomHarness) command(conn *websocket.Conn, cmd any) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, cmd); err != nil {
		h.t.Fatalf("send: %v", err)
	}
}

// queueCommand is a queue edit; in a room still filling it is answered
// with the room's refusal, one error frame per command.
func queueCommand() apitypes.RoomCommand {
	ids := []string{"9509"}
	return apitypes.RoomCommand{Type: apitypes.RoomCommandTypeQueue, PlayerIds: &ids}
}

// answer reads the next frame as an error frame.
func (h roomHarness) answer(conn *websocket.Conn) apitypes.RoomError {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var frame apitypes.RoomError
	if err := wsjson.Read(ctx, conn, &frame); err != nil {
		h.t.Fatalf("no frame: %v", err)
	}
	return frame
}

func (h roomHarness) revoke(id uuid.UUID) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `update app.devices set revoked_at = $2 where id = $1`, id, socketNow()); err != nil {
		h.t.Fatal(err)
	}
}

// signIn is a live session cookie for the account.
func (h roomHarness) signIn(account uuid.UUID) []*http.Cookie {
	h.t.Helper()
	token := []byte(strings.ReplaceAll(account.String(), "-", ""))
	if err := h.accounts.CreateSession(context.Background(), account, auth.TokenHash(string(token)), "", "test", socketNow()); err != nil {
		h.t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.sessions.Issue(w, token)
	return w.Result().Cookies()
}

func (h roomHarness) url(query string) string {
	return "ws" + strings.TrimPrefix(h.srv.URL, "http") + "/rooms/" + h.room.String() + "/ws" + query
}

// dial opens the room's socket with a bearer token, cookies, or both,
// and answers the upgrade's status.
func (h roomHarness) dial(query, token string, cookies []*http.Cookie) (*websocket.Conn, int) {
	h.t.Helper()
	conn, status, _ := h.dialBody(query, token, cookies)
	return conn, status
}

// envelope is the API's error envelope on a refused upgrade.
type envelope struct {
	OK        bool    `json:"ok"`
	Data      *string `json:"data"`
	RequestID string  `json:"request_id"`
	Error     struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// refused dials, wants status, and answers the refusal's envelope.
func (h roomHarness) refused(name, query, token string, cookies []*http.Cookie, status int) envelope {
	h.t.Helper()
	_, got, body := h.dialBody(query, token, cookies)
	if got != status {
		h.t.Fatalf("%s: %d, want %d", name, got, status)
	}
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		h.t.Fatalf("%s: the body %q is not the envelope: %v", name, body, err)
	}
	if env.OK || env.Data != nil || env.RequestID == "" {
		h.t.Fatalf("%s: envelope %+v", name, env)
	}
	return env
}

// dialBody is dial with the refused upgrade's body.
func (h roomHarness) dialBody(query, token string, cookies []*http.Cookie) (*websocket.Conn, int, []byte) {
	h.t.Helper()
	header := http.Header{}
	if token != "" {
		header.Set("Authorization", "Bearer "+token)
	}
	for _, c := range cookies {
		header.Add("Cookie", c.String())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, h.url(query), &websocket.DialOptions{HTTPHeader: header})
	var body []byte
	if resp != nil && resp.Body != nil {
		body, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
	}
	if err != nil {
		if resp == nil {
			h.t.Fatalf("dial: %v", err)
		}
		return nil, resp.StatusCode, body
	}
	h.t.Cleanup(func() { _ = conn.CloseNow() })
	return conn, http.StatusSwitchingProtocols, nil
}

// welcome sends the hello and reads the welcome.
func (h roomHarness) welcome(conn *websocket.Conn) apitypes.RoomWelcome {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, apitypes.RoomHello{Type: apitypes.RoomHelloTypeHello, LastSeq: 0}); err != nil {
		h.t.Fatal(err)
	}
	var w apitypes.RoomWelcome
	if err := wsjson.Read(ctx, conn, &w); err != nil {
		h.t.Fatal(err)
	}
	return w
}

// An app's token, carrying the session scope, opens the socket as its
// account: the welcome is alice's room.
func TestBearerWithSessionScopeOpensTheRoom(t *testing.T) {
	h := newRoomHarness(t)
	token, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	conn, status := h.dial("", token, nil)
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("an app's token was refused: %d", status)
	}
	if w := h.welcome(conn); w.Type != apitypes.RoomWelcomeTypeWelcome || w.RoomId != h.room || w.Seq < 1 {
		t.Fatalf("welcome %+v", w)
	}
	var lastUsed *time.Time
	if err := h.pool.QueryRow(context.Background(), `select last_used_at from app.devices where account_id = $1`, h.alice.ID).Scan(&lastUsed); err != nil {
		t.Fatal(err)
	}
	if lastUsed == nil || !lastUsed.Equal(socketNow()) {
		t.Fatalf("the upgrade did not note the device's use: %v", lastUsed)
	}
}

// Every token the api's session routes refuse, the upgrade refuses with
// the same 401: the extension's (no session scope), a lapsed app token,
// a revoked one, and a token sent in the query string.
func TestBearerRefusals(t *testing.T) {
	h := newRoomHarness(t)
	extension, _ := h.pair(h.alice.ID, auth.KindExtension, socketNow())
	lapsed, _ := h.pair(h.alice.ID, auth.KindAndroid, socketNow().Add(-auth.SessionTTL-time.Hour))
	revoked, revokedID := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	h.revoke(revokedID)
	live, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	cases := []struct {
		name, query, token string
	}{
		{"without the session scope", "", extension},
		{"lapsed", "", lapsed},
		{"revoked", "", revoked},
		{"in the query string", "?token=" + live, ""},
		{"as access_token in the query string", "?access_token=" + live, ""},
		{"none", "", ""},
	}
	for _, c := range cases {
		env := h.refused(c.name, c.query, c.token, nil, http.StatusUnauthorized)
		if env.Error.Code != httpx.CodeUnauthorized || env.Error.Message != auth.SignInMessage {
			t.Fatalf("%s: %+v, want the api's 401", c.name, env.Error)
		}
	}
}

// The cookie still opens the socket as before, and a request carrying a
// cookie and a bearer is the bearer's: bob's cookie alone has no seat
// (403), beside alice's token it is alice's room.
func TestCookieStillWorksAndBearerWinsBesideIt(t *testing.T) {
	h := newRoomHarness(t)
	conn, status := h.dial("", "", h.signIn(h.alice.ID))
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("alice's cookie was refused: %d", status)
	}
	h.welcome(conn)
	bobCookies := h.signIn(h.bob.ID)
	env := h.refused("bob's cookie", "", "", bobCookies, http.StatusForbidden)
	if env.Error.Code != httpx.CodeForbidden || env.Error.Message != "You do not have a seat in this room" {
		t.Fatalf("bob's cookie: %+v", env.Error)
	}
	token, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	conn, status = h.dial("", token, bobCookies)
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("alice's token beside bob's cookie: %d", status)
	}
	if w := h.welcome(conn); w.RoomId != h.room {
		t.Fatalf("welcome %+v", w)
	}
}

// A socket an app opened is closed with 1008 and the 401's error frame
// once its token is revoked, read at the next ping.
func TestRevokedTokenClosesItsSocket(t *testing.T) {
	h := newRoomHarness(t)
	token, id := h.pair(h.alice.ID, auth.KindAndroid, socketNow())
	conn, status := h.dial("", token, nil)
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("refused: %d", status)
	}
	h.welcome(conn)
	h.revoke(id)
	h.tick()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var frame apitypes.RoomError
	if err := wsjson.Read(ctx, conn, &frame); err != nil {
		t.Fatalf("no error frame: %v", err)
	}
	if frame.Type != apitypes.RoomErrorTypeError || frame.Code != httpx.CodeUnauthorized || frame.Message != auth.SignInMessage {
		t.Fatalf("frame %+v", frame)
	}
	_, _, err := conn.Read(ctx)
	var closeErr websocket.CloseError
	if !errors.As(err, &closeErr) || closeErr.Code != websocket.StatusPolicyViolation || closeErr.Reason != "signed out" {
		t.Fatalf("close: %v", err)
	}
}

// A cookie's socket is not re-read by the device check: across several
// heartbeats nothing is sent to it and it stays open, each sentinel
// command's answer the first frame after its tick.
func TestCookieSocketIsNotDeviceChecked(t *testing.T) {
	h := newRoomHarness(t)
	conn, status := h.dial("", "", h.signIn(h.alice.ID))
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("refused: %d", status)
	}
	h.welcome(conn)
	for i := 0; i < 3; i++ {
		h.tick()
		h.command(conn, queueCommand())
		if frame := h.answer(conn); frame.Code != httpx.CodeConflict {
			t.Fatalf("beat %d: the first frame was not the command's answer: %+v", i, frame)
		}
	}
}

// A ping out does not stall the commands behind it (B192): commands sent
// while each ping waits for its pong are all answered, in order, and the
// socket stays open. Before the fix the reader parked on the first
// command, the pong behind it went unread and the socket dropped.
func TestCommandsWhileAPingIsOut(t *testing.T) {
	h := newRoomHarness(t)
	token, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	conn, status := h.dial("", token, nil)
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("refused: %d", status)
	}
	h.welcome(conn)
	const commands = 9 // with the last, the queue budget's burst of 10
	for i := 0; i < commands; i++ {
		// The client does not read until the end, so the first ping's pong
		// stays unread the whole time: every command arrives with a ping out.
		h.tick()
		h.command(conn, queueCommand())
	}
	for i := 0; i < commands; i++ {
		if frame := h.answer(conn); frame.Type != apitypes.RoomErrorTypeError || frame.Code != httpx.CodeConflict {
			t.Fatalf("command %d: %+v", i, frame)
		}
	}
	h.tick()
	h.command(conn, queueCommand())
	if frame := h.answer(conn); frame.Code != httpx.CodeConflict {
		t.Fatalf("the socket after the pings: %+v", frame)
	}
}

// flakyDevices is the socket's re-read of a device token answering errs
// in turn, then auth.ErrNoDevice; each call is signalled on called.
type flakyDevices struct {
	mu     sync.Mutex
	errs   []error
	called chan struct{}
}

func (f *flakyDevices) SessionDevice(context.Context, *http.Request) (auth.Account, auth.Device, error) {
	f.mu.Lock()
	err := auth.ErrNoDevice
	if len(f.errs) > 0 {
		err, f.errs = f.errs[0], f.errs[1:]
	}
	f.mu.Unlock()
	f.called <- struct{}{}
	return auth.Account{}, auth.Device{}, err
}

func (f *flakyDevices) wait(t *testing.T) {
	t.Helper()
	select {
	case <-f.called:
	case <-time.After(5 * time.Second):
		t.Fatal("the beat did not re-read the token")
	}
}

// readResult is one frame a background reader read, or its end.
type readResult struct {
	frame apitypes.RoomError
	err   error
}

// reader reads every frame in the background, so the client answers the
// server's pings while the test waits on something else.
func reader(conn *websocket.Conn) <-chan readResult {
	out := make(chan readResult, 8)
	go func() {
		for {
			var frame apitypes.RoomError
			err := wsjson.Read(context.Background(), conn, &frame)
			out <- readResult{frame, err}
			if err != nil {
				return
			}
		}
	}()
	return out
}

// A failed re-read (a database blip) keeps the app's socket: only the
// next beat's definite "revoked" closes it with the 401's frame and 1008.
func TestTransientDeviceReadKeepsTheSocket(t *testing.T) {
	flaky := &flakyDevices{errs: []error{errors.New("devices: resolve: connection reset")}, called: make(chan struct{}, 4)}
	h := newRoomHarnessWith(t, func(*auth.Bearer) rooms.DeviceSessions { return flaky })
	token, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	conn, status := h.dial("", token, nil)
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("refused: %d", status)
	}
	h.welcome(conn)
	frames := reader(conn)
	h.tick()
	flaky.wait(t)
	h.command(conn, queueCommand())
	if r := <-frames; r.err != nil || r.frame.Code != httpx.CodeConflict {
		t.Fatalf("after the failed read the socket did not answer its command first: %+v", r)
	}
	h.tick()
	flaky.wait(t)
	if r := <-frames; r.err != nil || r.frame.Code != httpx.CodeUnauthorized || r.frame.Message != auth.SignInMessage {
		t.Fatalf("after the revocation: %+v", r)
	}
	r := <-frames
	var closeErr websocket.CloseError
	if !errors.As(r.err, &closeErr) || closeErr.Code != websocket.StatusPolicyViolation || closeErr.Reason != "signed out" {
		t.Fatalf("close: %v", r.err)
	}
}

// A device upgrade on a room with no device check is refused (500) and
// never upgraded, rather than left unchecked.
func TestDeviceSocketWithoutACheckIsRefused(t *testing.T) {
	h := newRoomHarnessWith(t, func(*auth.Bearer) rooms.DeviceSessions { return nil })
	token, _ := h.pair(h.alice.ID, auth.KindIOS, socketNow())
	env := h.refused("no device check", "", token, nil, http.StatusInternalServerError)
	if env.Error.Code != httpx.CodeInternal {
		t.Fatalf("%+v", env.Error)
	}
	if _, status := h.dial("", "", h.signIn(h.alice.ID)); status != http.StatusSwitchingProtocols {
		t.Fatalf("the cookie upgrade beside it: %d", status)
	}
}
