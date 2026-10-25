package rooms_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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

// testPing is the heartbeat in these tests, so a revocation is read
// within a few milliseconds instead of ten seconds.
const testPing = 40 * time.Millisecond

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
	alice    auth.Account
	bob      auth.Account
}

func newRoomHarness(t *testing.T) roomHarness {
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
	socket := &rooms.Socket{Lobby: store, Hub: &rooms.Hub{Log: quietLog()}, Devices: bearer, PingEvery: testPing, Now: socketNow, Log: quietLog()}
	mux := http.NewServeMux()
	if err := server.Mount(mux, socket.Routes(), sessions, bearer, socketNow); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(httpx.RequestID()(mux))
	t.Cleanup(srv.Close)
	return roomHarness{t: t, pool: pool, srv: srv, bearer: bearer, sessions: sessions, accounts: accounts, room: room, alice: alice, bob: bob}
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
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		if resp == nil {
			h.t.Fatalf("dial: %v", err)
		}
		return nil, resp.StatusCode
	}
	h.t.Cleanup(func() { _ = conn.CloseNow() })
	return conn, http.StatusSwitchingProtocols
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
		if _, status := h.dial(c.query, c.token, nil); status != http.StatusUnauthorized {
			t.Fatalf("%s: %d, want 401", c.name, status)
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
	if _, status := h.dial("", "", bobCookies); status != http.StatusForbidden {
		t.Fatalf("bob's cookie: %d, want 403", status)
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
// pings nothing is sent to it and it is not closed. The client answers
// pings only while it reads, so it reads until its own deadline.
func TestCookieSocketIsNotDeviceChecked(t *testing.T) {
	h := newRoomHarness(t)
	conn, status := h.dial("", "", h.signIn(h.alice.ID))
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("refused: %d", status)
	}
	h.welcome(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 6*testPing)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if ctx.Err() == nil || websocket.CloseStatus(err) != -1 {
		t.Fatalf("a cookie's socket was sent something or closed: %v", err)
	}
}
