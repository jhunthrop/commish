package devices

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/server"
)

const testPassword = "a-test-cookie-password-of-at-least-32-chars"

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestCodesAreSixListWordsAndNormalize(t *testing.T) {
	code, err := NewCode()
	if err != nil {
		t.Fatal(err)
	}
	if n := len(strings.Fields(code)); n != CodeWords {
		t.Fatalf("code %q has %d words", code, n)
	}
	typed := strings.ToUpper(strings.ReplaceAll(code, " ", " - "))
	if got, ok := NormalizeCode(typed); !ok || got != code {
		t.Fatalf("typed %q read as %q (%v)", typed, got, ok)
	}
	for _, bad := range []string{"", "acorn amber", "acorn amber anchor apple arch zzzzz", strings.Repeat("acorn ", 7)} {
		if _, ok := NormalizeCode(bad); ok {
			t.Fatalf("%q read as a code", bad)
		}
	}
}

func TestCleanName(t *testing.T) {
	if got := CleanName("  Chrome‮ on\tMac\u0000 "); got != "Chrome on Mac" {
		t.Fatalf("got %q", got)
	}
	if got := CleanName(strings.Repeat("é", 90)); len([]rune(got)) != maxNameLen {
		t.Fatalf("not cut: %d runes", len([]rune(got)))
	}
}

// harness is the device routes mounted the way the api mounts them.
type harness struct {
	t       *testing.T
	handler http.Handler
	svc     *Service
	clock   *clock
}

func newHarness(t *testing.T) (harness, auth.Account, auth.Account) {
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
	c := &clock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	store := &Store{Pool: pool}
	sessions, err := auth.NewSessions(config.Session{CookiePassword: testPassword}, 0, accounts, c.Now, quiet())
	if err != nil {
		t.Fatal(err)
	}
	bearer, err := auth.NewBearer(testPassword, 0, store, c.Now, quiet())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: store, Tokens: bearer, Now: c.Now, Log: quiet()}
	routes := append(svc.Routes(), httpx.Route{Method: http.MethodGet, Path: "/session-only", Access: httpx.SignedIn,
		Limit: httpx.PerMinute(60), Handler: func(w http.ResponseWriter, r *http.Request) { httpx.WriteOK(w, r, 200, nil) }})
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, bearer, c.Now); err != nil {
		t.Fatal(err)
	}
	return harness{t: t, handler: mux, svc: svc, clock: c}, alice, bob
}

// signedIn calls a session handler directly as the account.
func (h harness) signedIn(fn http.HandlerFunc, acct auth.Account, method, id string) (int, []byte) {
	r := httptest.NewRequest(method, "/", nil)
	if id != "" {
		r.SetPathValue("id", id)
	}
	r = r.WithContext(auth.WithAccount(r.Context(), acct))
	w := httptest.NewRecorder()
	fn(w, r)
	return w.Code, data(w.Body.Bytes())
}

// call goes through the mounted routes with an optional bearer token.
func (h harness) call(method, path, token string, body any) (int, []byte) {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	return w.Code, data(w.Body.Bytes())
}

func data(b []byte) []byte {
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(b, &env)
	return env.Data
}

func (h harness) code(acct auth.Account) string {
	status, body := h.signedIn(h.svc.code, acct, http.MethodPost, "")
	var c apitypes.PairCode
	if status != http.StatusCreated || json.Unmarshal(body, &c) != nil {
		h.t.Fatalf("code: %d %s", status, body)
	}
	return c.Code
}

// A code pairs one browser once, inside ten minutes; the token opens the
// device routes and nothing else, never the session's; a revoked token
// opens nothing; one account never sees or revokes another's browser.
func TestPairingAndTheBearerPath(t *testing.T) {
	h, alice, bob := newHarness(t)
	code := h.code(alice)

	status, body := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: strings.ToUpper(code), Name: strp("Chrome‮ on Mac")})
	var paired apitypes.Paired
	if status != http.StatusCreated || json.Unmarshal(body, &paired) != nil || paired.Token == "" {
		t.Fatalf("pair: %d %s", status, body)
	}
	if paired.Device.Name != "Chrome on Mac" || len(paired.Device.Scopes) != 2 {
		t.Fatalf("device %+v", paired.Device)
	}
	if status, _ := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: code}); status != http.StatusBadRequest {
		t.Fatalf("a used code paired again: %d", status)
	}

	status, body = h.call(http.MethodGet, "/devices/me", paired.Token, nil)
	var me apitypes.DeviceMe
	if status != http.StatusOK || json.Unmarshal(body, &me) != nil || me.Device.Id != paired.Device.Id {
		t.Fatalf("me: %d %s", status, body)
	}
	if status, _ := h.call(http.MethodGet, "/session-only", paired.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("a device token opened a session route: %d", status)
	}
	if status, _ := h.call(http.MethodGet, "/devices/me", "", nil); status != http.StatusUnauthorized {
		t.Fatalf("no token: %d", status)
	}
	forged := paired.Token[:len(paired.Token)-2] + "AA"
	if status, _ := h.call(http.MethodGet, "/devices/me", forged, nil); status != http.StatusUnauthorized {
		t.Fatalf("a forged token: %d", status)
	}

	if status, _ := h.signedIn(h.svc.revoke, bob, http.MethodDelete, paired.Device.Id.String()); status != http.StatusNotFound {
		t.Fatalf("bob revoked alice's browser: %d", status)
	}
	status, body = h.signedIn(h.svc.list, bob, http.MethodGet, "")
	if status != http.StatusOK || string(body) != "[]" {
		t.Fatalf("bob's list: %d %s", status, body)
	}
	status, body = h.signedIn(h.svc.list, alice, http.MethodGet, "")
	if status != http.StatusOK || !strings.Contains(string(body), paired.Device.Id.String()) {
		t.Fatalf("alice's list: %d %s", status, body)
	}
	if status, _ := h.signedIn(h.svc.revoke, alice, http.MethodDelete, paired.Device.Id.String()); status != http.StatusOK {
		t.Fatalf("revoke: %d", status)
	}
	if status, _ := h.call(http.MethodGet, "/devices/me", paired.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("a revoked token: %d", status)
	}
}

func TestCodesExpireAndAreReplaced(t *testing.T) {
	h, alice, _ := newHarness(t)
	first := h.code(alice)
	second := h.code(alice)
	if status, _ := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: first}); status != http.StatusBadRequest {
		t.Fatalf("a replaced code paired: %d", status)
	}
	h.clock.now = h.clock.now.Add(CodeTTL)
	if status, _ := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: second}); status != http.StatusBadRequest {
		t.Fatalf("an expired code paired: %d", status)
	}
}

func TestDeviceCap(t *testing.T) {
	h, alice, _ := newHarness(t)
	for i := range MaxDevices + 1 {
		status, body := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: h.code(alice)})
		want := http.StatusCreated
		if i == MaxDevices {
			want = http.StatusConflict
		}
		if status != want {
			t.Fatalf("pairing %d: %d %s", i+1, status, body)
		}
		h.clock.now = h.clock.now.Add(7 * time.Second) // under the pairing route's limit
	}
}

func strp(s string) *string { return &s }
