package devices

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

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
	t        *testing.T
	handler  http.Handler
	svc      *Service
	clock    *clock
	accounts *auth.Store
	sessions *auth.Sessions
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
	codeKey, err := auth.DeriveKey(testPassword, PurposeCodes)
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: store, Push: store, Tokens: bearer, CodeKey: codeKey, Now: c.Now, Log: quiet()}
	ok := func(w http.ResponseWriter, r *http.Request) { httpx.WriteOK(w, r, 200, nil) }
	routes := append(svc.Routes(),
		httpx.Route{Method: http.MethodGet, Path: sessionRoute, Access: httpx.SignedIn, Limit: httpx.PerMinute(60), Handler: ok},
		httpx.Route{Method: http.MethodPost, Path: sessionRoute, Access: httpx.SignedIn, Limit: httpx.PerMinute(60), Handler: ok})
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, bearer, c.Now); err != nil {
		t.Fatal(err)
	}
	return harness{t: t, handler: mux, svc: svc, clock: c, accounts: accounts, sessions: sessions}, alice, bob
}

// sessionRoute stands for every signed-in route, the leagues an app reads
// first.
const sessionRoute = "/leagues/attached"

// cookie is a live browser session for the account, as the callback
// issues one.
func (h harness) cookie(acct auth.Account) []*http.Cookie {
	token := []byte(strings.Repeat("c", 32))
	if err := h.accounts.CreateSession(context.Background(), acct.ID, auth.TokenHash(string(token)), "", "", h.clock.now); err != nil {
		h.t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.sessions.Issue(w, token)
	return w.Result().Cookies()
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
	return h.callWith(method, path, token, nil, body)
}

// callWith is call with cookies beside the token.
func (h harness) callWith(method, path, token string, cookies []*http.Cookie, body any) (int, []byte) {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for _, c := range cookies {
		r.AddCookie(c)
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
	if status, _ := h.call(http.MethodGet, sessionRoute, paired.Token, nil); status != http.StatusUnauthorized {
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

func kindp(k apitypes.DeviceKind) *apitypes.DeviceKind { return &k }

// A fixed PKCE pair, the challenge computed apart from this code.
const (
	testVerifier  = "dBjftJeZ4CVP-mJ92K9F_dRwOR6lh1NcvnNyJRVKRQ4"
	testChallenge = "8Gupdd4T5YR22GTKmsYs9odoxLTD8iuFKqtpc8YlXEU"
)

// appCode is the code an app's sign-in hands back for kind, under the
// test challenge.
func (h harness) appCode(acct auth.Account, kind auth.DeviceKind) string {
	code, err := h.svc.AppCode(context.Background(), acct.ID, kind, testChallenge, "")
	if err != nil {
		h.t.Fatalf("app code: %v", err)
	}
	return code
}

// pairAs pairs code as kind, with verifier when it is not empty.
func (h harness) pairAs(code string, kind *apitypes.DeviceKind, verifier string) (int, apitypes.Paired) {
	in := apitypes.PairInput{Code: code, Kind: kind}
	if verifier != "" {
		in.CodeVerifier = &verifier
	}
	status, body := h.call(http.MethodPost, "/devices/pair", "", in)
	var p apitypes.Paired
	_ = json.Unmarshal(body, &p)
	return status, p
}

// pairApp pairs a fresh device of an app kind for acct and answers it.
func (h harness) pairApp(acct auth.Account, kind auth.DeviceKind) apitypes.Paired {
	status, p := h.pairAs(h.appCode(acct, kind), kindp(apitypes.DeviceKind(kind)), testVerifier)
	if status != http.StatusCreated {
		h.t.Fatalf("%s pair: %d", kind, status)
	}
	h.clock.now = h.clock.now.Add(7 * time.Second) // under the pairing route's limit
	return p
}

// An app pairs with its sign-in's code and carries the session scope, so
// its token opens the session's routes; the extension's pairing, with or
// without the word, does not; the list names each device's kind.
func TestPairingByKind(t *testing.T) {
	h, alice, _ := newHarness(t)
	for _, kind := range []auth.DeviceKind{auth.KindIOS, auth.KindAndroid} {
		p := h.pairApp(alice, kind)
		if p.Device.Kind == nil || string(*p.Device.Kind) != string(kind) {
			t.Fatalf("%s device %+v", kind, p.Device)
		}
		if !slices.Contains(p.Device.Scopes, apitypes.DeviceScopeSession) || len(p.Device.Scopes) != 3 {
			t.Fatalf("%s scopes %v", kind, p.Device.Scopes)
		}
		if status, _ := h.call(http.MethodGet, sessionRoute, p.Token, nil); status != http.StatusOK {
			t.Fatalf("%s token on a session route: %d", kind, status)
		}
	}
	for _, kind := range []*apitypes.DeviceKind{nil, kindp(apitypes.DeviceKindExtension)} {
		status, p := h.pairAs(h.code(alice), kind, "")
		if status != http.StatusCreated || p.Device.Kind == nil || *p.Device.Kind != apitypes.DeviceKindExtension {
			t.Fatalf("extension pair: %d %+v", status, p.Device)
		}
		if slices.Contains(p.Device.Scopes, apitypes.DeviceScopeSession) {
			t.Fatalf("an extension carries the session scope: %v", p.Device.Scopes)
		}
		if status, _ := h.call(http.MethodGet, sessionRoute, p.Token, nil); status != http.StatusUnauthorized {
			t.Fatalf("an extension token on a session route: %d", status)
		}
		h.clock.now = h.clock.now.Add(7 * time.Second)
	}
	status, body := h.signedIn(h.svc.list, alice, http.MethodGet, "")
	var list []apitypes.Device
	if status != http.StatusOK || json.Unmarshal(body, &list) != nil || len(list) != 4 {
		t.Fatalf("list: %d %s", status, body)
	}
	kinds := map[apitypes.DeviceKind]int{}
	for _, d := range list {
		if d.Kind == nil {
			t.Fatalf("a listed device without its kind: %+v", d)
		}
		kinds[*d.Kind]++
	}
	if kinds[apitypes.DeviceKindIos] != 1 || kinds[apitypes.DeviceKindAndroid] != 1 || kinds[apitypes.DeviceKindExtension] != 2 {
		t.Fatalf("kinds %v", kinds)
	}
}

// A code pairs only the kind it was minted for: the account page's code
// never mints an app's session scope, an app's code never pairs another
// kind, and an unknown kind is refused.
func TestCodesPairOnlyTheirKind(t *testing.T) {
	h, alice, _ := newHarness(t)
	page := h.code(alice)
	if status, _ := h.pairAs(page, kindp(apitypes.DeviceKindIos), testVerifier); status != http.StatusBadRequest {
		t.Fatalf("the account page's code paired an app: %d", status)
	}
	h.clock.now = h.clock.now.Add(7 * time.Second)
	ios := h.appCode(alice, auth.KindIOS)
	for _, kind := range []*apitypes.DeviceKind{nil, kindp(apitypes.DeviceKindExtension), kindp(apitypes.DeviceKindAndroid)} {
		if status, _ := h.pairAs(ios, kind, testVerifier); status != http.StatusBadRequest {
			t.Fatalf("an iOS code paired as %v: %d", kind, status)
		}
		h.clock.now = h.clock.now.Add(7 * time.Second)
	}
	status, body := h.call(http.MethodPost, "/devices/pair", "", map[string]string{"code": ios, "kind": "watch"})
	if status != http.StatusBadRequest {
		t.Fatalf("an unknown kind: %d %s", status, body)
	}
	if _, err := h.svc.AppCode(context.Background(), alice.ID, auth.KindExtension, testChallenge, ""); err == nil {
		t.Fatal("an app code was minted for the extension")
	}
	if _, err := h.svc.AppCode(context.Background(), alice.ID, auth.KindIOS, "", ""); err == nil {
		t.Fatal("an app code was minted with no challenge")
	}
}

// An app's code pairs only with the verifier behind its challenge: none,
// a malformed one or a wrong one is 400 and spends nothing, so the app
// that holds the verifier still pairs; the extension's code needs none.
func TestAppCodesNeedTheVerifier(t *testing.T) {
	h, alice, _ := newHarness(t)
	ios := kindp(apitypes.DeviceKindIos)
	code := h.appCode(alice, auth.KindIOS)
	for _, verifier := range []string{"", "short", strings.Repeat("a", 43), testVerifier + "x"} {
		status, p := h.pairAs(code, ios, verifier)
		if status != http.StatusBadRequest || p.Token != "" {
			t.Fatalf("pair with verifier %q: %d", verifier, status)
		}
		h.clock.now = h.clock.now.Add(7 * time.Second)
	}
	if status, p := h.pairAs(code, ios, testVerifier); status != http.StatusCreated || p.Token == "" {
		t.Fatalf("the app's own verifier: %d", status)
	}
	h.clock.now = h.clock.now.Add(7 * time.Second)
	if status, _ := h.pairAs(h.code(alice), nil, ""); status != http.StatusCreated {
		t.Fatalf("an extension code without a verifier: %d", status)
	}
}

// An app's token, the whole account, ends with revocation: the signed-in
// route answers 401 from the next request, and the revoked token beside a
// live cookie is no way past the cookie's CSRF check.
func TestRevokedAppTokenFailsClosed(t *testing.T) {
	h, alice, _ := newHarness(t)
	p := h.pairApp(alice, auth.KindIOS)
	if status, _ := h.call(http.MethodGet, sessionRoute, p.Token, nil); status != http.StatusOK {
		t.Fatalf("before revoking: %d", status)
	}
	if status, _ := h.signedIn(h.svc.revoke, alice, http.MethodDelete, p.Device.Id.String()); status != http.StatusOK {
		t.Fatalf("revoke: %d", status)
	}
	if status, _ := h.call(http.MethodGet, sessionRoute, p.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("a revoked app token on a signed-in route: %d", status)
	}
	cookies := h.cookie(alice)
	if status, _ := h.callWith(http.MethodGet, sessionRoute, "", cookies, nil); status != http.StatusOK {
		t.Fatalf("the live cookie alone: %d", status)
	}
	if status, _ := h.callWith(http.MethodPost, sessionRoute, p.Token, cookies, nil); status != http.StatusForbidden {
		t.Fatalf("a revoked token beside a cookie, no CSRF: %d", status)
	}
}

// An app's token lapses like the browser session it stands in for: idle
// past auth.SessionTTL it opens nothing, while one used within it slides.
// The extension's token, which reaches only the device routes, does not
// lapse.
func TestAppTokensLapseWhenIdle(t *testing.T) {
	h, alice, _ := newHarness(t)
	idle := h.pairApp(alice, auth.KindIOS)
	used := h.pairApp(alice, auth.KindAndroid)
	status, body := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: h.code(alice)})
	var ext apitypes.Paired
	if status != http.StatusCreated || json.Unmarshal(body, &ext) != nil {
		t.Fatalf("extension pair: %d", status)
	}

	h.clock.now = h.clock.now.Add(auth.SessionTTL - time.Hour)
	if status, _ := h.call(http.MethodGet, sessionRoute, used.Token, nil); status != http.StatusOK {
		t.Fatalf("an app token used inside the session's life: %d", status)
	}
	h.clock.now = h.clock.now.Add(2 * time.Hour)
	if status, _ := h.call(http.MethodGet, sessionRoute, idle.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("an app token idle past the session's life: %d", status)
	}
	if status, _ := h.call(http.MethodGet, "/devices/me", idle.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("an idle app token on a device route: %d", status)
	}
	if status, _ := h.call(http.MethodGet, sessionRoute, used.Token, nil); status != http.StatusOK {
		t.Fatalf("a used app token did not slide: %d", status)
	}
	if status, _ := h.call(http.MethodGet, "/devices/me", ext.Token, nil); status != http.StatusOK {
		t.Fatalf("an extension token lapsed: %d", status)
	}
}

// The WorkOS session column (Lane 225, B212): an app's code carries the
// sign-in's session to the device it pairs, and revoking the device
// answers it and clears it from the row; the account page's revoke (a
// cookie, no device on the request) is answered null; a code's id is
// held to 200 characters; and the extension's device can never carry
// one. Both refusals are the check constraint's own (23514).
func TestDevicesKeepTheWorkOSSession(t *testing.T) {
	h, alice, _ := newHarness(t)
	ctx := context.Background()
	store, ok := h.svc.Store.(*Store)
	if !ok {
		t.Fatal("the harness store is not the database's")
	}

	code, err := h.svc.AppCode(ctx, alice.ID, auth.KindAndroid, testChallenge, "session_store")
	if err != nil {
		t.Fatal(err)
	}
	status, kept := h.pairAs(code, kindp(apitypes.DeviceKindAndroid), testVerifier)
	if status != http.StatusCreated {
		t.Fatalf("pair: %d", status)
	}
	h.clock.now = h.clock.now.Add(7 * time.Second) // under the pairing route's limit
	none := h.pairApp(alice, auth.KindIOS)

	if sid, err := store.Revoke(ctx, alice.ID, kept.Device.Id, h.clock.now); err != nil || sid != "session_store" {
		t.Fatalf("revoke answered %q, %v", sid, err)
	}
	var left *string
	if err := store.Pool.QueryRow(ctx, `select workos_session_id from app.devices where id = $1`, kept.Device.Id).Scan(&left); err != nil || left != nil {
		t.Fatalf("the revoked device kept %v (%v)", left, err)
	}
	if _, err := store.Revoke(ctx, alice.ID, kept.Device.Id, h.clock.now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoking twice: %v", err)
	}
	status, body := h.signedIn(h.svc.revoke, alice, http.MethodDelete, none.Device.Id.String())
	if status != http.StatusOK || string(body) != "null" {
		t.Fatalf("the account page's revoke: %d %s", status, body)
	}

	hash := codeHash(h.svc.CodeKey, "acorn amber anchor apple arch atlas")
	long := strings.Repeat("s", 201)
	if err := store.PutCode(ctx, alice.ID, Binding{Kind: auth.KindIOS, Challenge: testChallenge}, hash, h.clock.now.Add(CodeTTL), long); !isCheckViolation(err) {
		t.Fatalf("a code with a 201-character WorkOS session: %v", err)
	}
	status, body = h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: h.code(alice)})
	var ext apitypes.Paired
	if status != http.StatusCreated || json.Unmarshal(body, &ext) != nil {
		t.Fatalf("extension pair: %d", status)
	}
	_, err = store.Pool.Exec(ctx, `update app.devices set workos_session_id = 'session_ext' where id = $1`, ext.Device.Id)
	if !isCheckViolation(err) {
		t.Fatalf("an extension device carried a WorkOS session: %v", err)
	}
}

// The deploy window (Lane 225 review L2): the binary before Lane 225
// upserts the account page's code over an app code without naming the
// WorkOS column, so the row keeps the app's id beside kind 'extension'.
// The codes check takes it, and pairing the extension from it answers 201
// with no id on the extension's device.
func TestAnOldBinarysExtensionCodeOverAnAppCodePairs(t *testing.T) {
	h, alice, _ := newHarness(t)
	ctx := context.Background()
	store, ok := h.svc.Store.(*Store)
	if !ok {
		t.Fatal("the harness store is not the database's")
	}
	if _, err := h.svc.AppCode(ctx, alice.ID, auth.KindIOS, testChallenge, "session_app"); err != nil {
		t.Fatal(err)
	}
	const code = "acorn amber anchor apple arch atlas"
	// main's PutCode before Lane 225, word for word.
	if _, err := store.Pool.Exec(ctx, `insert into app.device_pair_codes (account_id, code_hash, expires_at, kind, code_challenge)
		values ($1, $2, $3, $4, $5)
		on conflict (account_id) do update
		  set code_hash = excluded.code_hash, expires_at = excluded.expires_at, kind = excluded.kind,
		      code_challenge = excluded.code_challenge, created_at = now()`,
		alice.ID, codeHash(h.svc.CodeKey, code), h.clock.now.Add(CodeTTL), string(auth.KindExtension), nil); err != nil {
		t.Fatalf("the old binary's extension code: %v", err)
	}
	status, body := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: code})
	var ext apitypes.Paired
	if status != http.StatusCreated || json.Unmarshal(body, &ext) != nil {
		t.Fatalf("extension pair from the old binary's code: %d %s", status, body)
	}
	var sid *string
	if err := store.Pool.QueryRow(ctx, `select workos_session_id from app.devices where id = $1`, ext.Device.Id).Scan(&sid); err != nil || sid != nil {
		t.Fatalf("the extension device holds %v (%v)", sid, err)
	}
}

// isCheckViolation reports whether err is Postgres refusing a check
// constraint (23514).
func isCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
