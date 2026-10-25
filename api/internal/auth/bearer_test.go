package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/server"
)

const bearerTestPassword = "a-bearer-test-cookie-password-of-32-chars"

func fixedNow() time.Time { return time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC) }

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// fakeDevices is a devices table in memory: token hash to its device.
type fakeDevices struct {
	acct    auth.Account
	byHash  map[string]auth.Device
	lookups int
}

func (f *fakeDevices) DeviceAccount(_ context.Context, hash []byte, _ time.Time) (auth.Account, auth.Device, error) {
	f.lookups++
	d, ok := f.byHash[string(hash)]
	if !ok {
		return auth.Account{}, auth.Device{}, auth.ErrNoDevice
	}
	return f.acct, d, nil
}

// fakeSessions is a sessions table in memory: every live hash is acct's.
type fakeSessions struct {
	acct auth.Account
	live map[string]bool
}

func (f *fakeSessions) SessionAccount(_ context.Context, hash []byte, _ time.Time) (auth.Account, bool, error) {
	if !f.live[string(hash)] {
		return auth.Account{}, false, auth.ErrNoSession
	}
	return f.acct, false, nil
}

type bearerHarness struct {
	handler  http.Handler
	bearer   *auth.Bearer
	devices  *fakeDevices
	sessions *auth.Sessions
	live     *fakeSessions
}

// newBearerHarness mounts a SignedIn route, a Public route and a device
// route the way the api mounts them, each answering the account it saw.
func newBearerHarness(t *testing.T) bearerHarness {
	t.Helper()
	acct := auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000a1"), Email: "alice@example.invalid"}
	devs := &fakeDevices{acct: acct, byHash: map[string]auth.Device{}}
	live := &fakeSessions{acct: acct, live: map[string]bool{}}
	sessions, err := auth.NewSessions(config.Session{CookiePassword: bearerTestPassword}, 0, live, fixedNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	bearer, err := auth.NewBearer(bearerTestPassword, 0, devs, fixedNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	who := func(w http.ResponseWriter, r *http.Request) {
		a, ok := auth.AccountFrom(r.Context())
		if !ok {
			httpx.WriteOK(w, r, http.StatusOK, "")
			return
		}
		httpx.WriteOK(w, r, http.StatusOK, a.ID.String())
	}
	limit := httpx.PerMinute(600)
	routes := []httpx.Route{
		{Method: http.MethodGet, Path: "/leagues/attached", Access: httpx.SignedIn, Limit: limit, Handler: who},
		{Method: http.MethodPost, Path: "/leagues/attached", Access: httpx.SignedIn, Limit: limit, Handler: who},
		{Method: http.MethodGet, Path: "/public", Access: httpx.Public, Limit: limit, Handler: who},
		{Method: http.MethodGet, Path: "/device", Access: httpx.Device, Scope: string(auth.ScopeLeagueWrite), Limit: limit, Handler: who},
	}
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, bearer, fixedNow); err != nil {
		t.Fatal(err)
	}
	return bearerHarness{handler: mux, bearer: bearer, devices: devs, sessions: sessions, live: live}
}

// pair mints a token for a device carrying scopes.
func (h bearerHarness) pair(scopes ...auth.Scope) string {
	token, hash := h.bearer.Mint()
	h.devices.byHash[string(hash)] = auth.Device{ID: uuid.New(), AccountID: h.devices.acct.ID, Scopes: scopes}
	return token
}

// signIn issues a live session cookie for the account.
func (h bearerHarness) signIn() []*http.Cookie {
	token := []byte(strings.Repeat("s", 32))
	h.live.live[string(auth.TokenHash(string(token)))] = true
	w := httptest.NewRecorder()
	h.sessions.Issue(w, token)
	return w.Result().Cookies()
}

func (h bearerHarness) call(method, path, token string, cookies []*http.Cookie) (int, string) {
	r := httptest.NewRequest(method, path, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	return w.Code, strings.Trim(string(env.Data), `"`)
}

// An app's token, carrying the session scope, opens a SignedIn route as
// its account, a write included with no CSRF token: nothing a browser
// sends on its own carries the header.
func TestSessionScopeOpensSignedInRoutes(t *testing.T) {
	h := newBearerHarness(t)
	token := h.pair(auth.ScopesFor(auth.KindIOS)...)
	want := h.devices.acct.ID.String()
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if status, who := h.call(method, "/leagues/attached", token, nil); status != http.StatusOK || who != want {
			t.Fatalf("%s with a session token: %d %q", method, status, who)
		}
	}
	if status, who := h.call(http.MethodGet, "/public", token, nil); status != http.StatusOK || who != want {
		t.Fatalf("a public route did not see the app's account: %d %q", status, who)
	}
	if status, _ := h.call(http.MethodGet, "/device", token, nil); status != http.StatusOK {
		t.Fatalf("the app's token lost the device route: %d", status)
	}
}

// The extension's token, without the session scope, still opens only
// the device routes: a SignedIn route answers 401 and a public route
// reads it as signed out.
func TestExtensionTokenStaysOffSignedInRoutes(t *testing.T) {
	h := newBearerHarness(t)
	token := h.pair(auth.ScopesFor(auth.KindExtension)...)
	if status, _ := h.call(http.MethodGet, "/leagues/attached", token, nil); status != http.StatusUnauthorized {
		t.Fatalf("an extension token opened a signed-in route: %d", status)
	}
	if status, who := h.call(http.MethodGet, "/public", token, nil); status != http.StatusOK || who != "" {
		t.Fatalf("an extension token signed in a public route: %d %q", status, who)
	}
	if status, _ := h.call(http.MethodGet, "/device", token, nil); status != http.StatusOK {
		t.Fatalf("the extension lost its device route: %d", status)
	}
	unknown, _ := h.bearer.Mint()
	if status, _ := h.call(http.MethodGet, "/leagues/attached", unknown, nil); status != http.StatusUnauthorized {
		t.Fatalf("an unknown token opened a signed-in route: %d", status)
	}
	if status, _ := h.call(http.MethodGet, "/leagues/attached", "cmd1.not-ours.AAAA", nil); status != http.StatusUnauthorized {
		t.Fatalf("a forged token opened a signed-in route: %d", status)
	}
}

// The session cookie works as before, its writes still need the CSRF
// token, and an extension token beside it changes nothing.
func TestSessionCookieStillWorks(t *testing.T) {
	h := newBearerHarness(t)
	cookies := h.signIn()
	want := h.devices.acct.ID.String()
	if status, who := h.call(http.MethodGet, "/leagues/attached", "", cookies); status != http.StatusOK || who != want {
		t.Fatalf("the cookie: %d %q", status, who)
	}
	ext := h.pair(auth.ScopesFor(auth.KindExtension)...)
	if status, who := h.call(http.MethodGet, "/leagues/attached", ext, cookies); status != http.StatusOK || who != want {
		t.Fatalf("the cookie beside an extension token: %d %q", status, who)
	}
	if status, _ := h.call(http.MethodPost, "/leagues/attached", ext, cookies); status != http.StatusForbidden {
		t.Fatalf("a cookie write without CSRF passed beside an extension token: %d", status)
	}
}

// A request with no bearer header reads no device.
func TestNoBearerNoDeviceRead(t *testing.T) {
	h := newBearerHarness(t)
	h.call(http.MethodGet, "/leagues/attached", "", nil)
	h.call(http.MethodGet, "/public", "", nil)
	if h.devices.lookups != 0 {
		t.Fatalf("%d device reads for requests without a token", h.devices.lookups)
	}
}

// Only the app kinds carry the session scope.
func TestScopesByKind(t *testing.T) {
	for _, kind := range []auth.DeviceKind{auth.KindIOS, auth.KindAndroid} {
		d := auth.Device{Scopes: auth.ScopesFor(kind)}
		if !d.Has(auth.ScopeSession) || !d.Has(auth.ScopeLeagueWrite) || !d.Has(auth.ScopeDraftWrite) {
			t.Fatalf("%s scopes %v", kind, d.Scopes)
		}
	}
	if d := (auth.Device{Scopes: auth.ScopesFor(auth.KindExtension)}); d.Has(auth.ScopeSession) || len(d.Scopes) != 2 {
		t.Fatalf("extension scopes %v", d.Scopes)
	}
	for _, raw := range []string{"ios", "android", "extension"} {
		if k, ok := auth.ParseDeviceKind(raw); !ok || string(k) != raw {
			t.Fatalf("%q did not parse", raw)
		}
	}
	for _, raw := range []string{"", "IOS", "web", "session"} {
		if _, ok := auth.ParseDeviceKind(raw); ok {
			t.Fatalf("%q parsed as a kind", raw)
		}
	}
}

// An app's token beside another account's session cookie is the token's
// request: the cookie is not read, so the account is the device's and a
// write asks no CSRF token.
func TestSessionTokenWinsBesideACookie(t *testing.T) {
	h := newBearerHarness(t)
	h.live.acct = auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000b2")}
	cookies := h.signIn()
	token := h.pair(auth.ScopesFor(auth.KindAndroid)...)
	want := h.devices.acct.ID.String()
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if status, who := h.call(method, "/leagues/attached", token, cookies); status != http.StatusOK || who != want {
			t.Fatalf("%s with a token and a cookie: %d %q, want the token's account", method, status, who)
		}
	}
	if status, who := h.call(http.MethodGet, "/leagues/attached", "", cookies); status != http.StatusOK || who != h.live.acct.ID.String() {
		t.Fatalf("the cookie alone: %d %q", status, who)
	}
}

// SessionDevice, the check the api's session routes and the room's socket
// share: a live app token resolves, and every other request is
// ErrNoDevice, a token in the query string among them; only the header
// is read, and only a well-formed token costs a device read.
func TestSessionDevice(t *testing.T) {
	h := newBearerHarness(t)
	app := h.pair(auth.ScopesFor(auth.KindIOS)...)
	ext := h.pair(auth.ScopesFor(auth.KindExtension)...)
	request := func(target, token string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, target, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		return r
	}
	acct, dev, err := h.bearer.SessionDevice(context.Background(), request("/rooms/x/ws", app))
	if err != nil || acct.ID != h.devices.acct.ID || !dev.Has(auth.ScopeSession) {
		t.Fatalf("an app token: %v %v %v", acct.ID, dev, err)
	}
	before := h.devices.lookups
	for name, r := range map[string]*http.Request{
		"no token":           request("/rooms/x/ws", ""),
		"query string token": request("/rooms/x/ws?token="+app, ""),
		"query access_token": request("/rooms/x/ws?access_token="+app, ""),
		"a token not ours":   request("/rooms/x/ws", "cmd1.not-ours.AAAA"),
		"not a device token": request("/rooms/x/ws", "abc"),
	} {
		if _, _, err := h.bearer.SessionDevice(context.Background(), r); !errors.Is(err, auth.ErrNoDevice) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if h.devices.lookups != before {
		t.Fatalf("%d device reads for requests with no well-formed token", h.devices.lookups-before)
	}
	if _, _, err := h.bearer.SessionDevice(context.Background(), request("/rooms/x/ws", ext)); !errors.Is(err, auth.ErrNoDevice) {
		t.Fatalf("the extension's token: %v", err)
	}
}

// A request carrying both a live app token and a session cookie is
// logged, by request id and device, never by the token.
func TestBothTokenAndCookieIsLogged(t *testing.T) {
	var logs strings.Builder
	devs := &fakeDevices{acct: auth.Account{ID: uuid.New()}, byHash: map[string]auth.Device{}}
	bearer, err := auth.NewBearer(bearerTestPassword, 0, devs, fixedNow, slog.New(slog.NewTextHandler(&logs, nil)))
	if err != nil {
		t.Fatal(err)
	}
	token, hash := bearer.Mint()
	devs.byHash[string(hash)] = auth.Device{ID: uuid.New(), AccountID: devs.acct.ID, Scopes: auth.ScopesFor(auth.KindIOS)}
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	h := bearer.SessionOr(ok, ok)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	h.ServeHTTP(httptest.NewRecorder(), r)
	if logs.Len() != 0 {
		t.Fatalf("a token alone was logged: %s", logs.String())
	}
	r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: "sealed"})
	h.ServeHTTP(httptest.NewRecorder(), r)
	if !strings.Contains(logs.String(), "the token used") || strings.Contains(logs.String(), token) {
		t.Fatalf("log %q", logs.String())
	}
}
