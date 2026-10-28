package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/devices"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/server"
)

const (
	siteURL  = "https://trycommish.app"
	appLink  = siteURL + "/app/signed-in"
	idpURL   = "https://auth.example.invalid/authorize"
	idpCode  = "workos-code"
	userID   = "user_app"
	appEmail = "app@example.invalid"
)

// The WorkOS session every sign-in through fakeIdP begins, and the
// logout endpoint its LogoutURL builds on.
const (
	workosSID = "session_1"
	logoutURL = "https://auth.example.invalid/logout"
)

// fakeIdP is AuthKit: it hands the state back in its URL, signs in one
// member for any code, and records each WorkOS session it was asked to
// end, with the return it was given. With logoutErr set, building the
// logout URL fails.
type fakeIdP struct {
	logouts   []string
	returns   []string
	logoutErr error
}

func (*fakeIdP) AuthorizationURL(state string, _ auth.Screen) (string, error) {
	return idpURL + "?state=" + url.QueryEscape(state), nil
}

func (*fakeIdP) Authenticate(_ context.Context, code, _, _ string) (auth.Identity, error) {
	if code != idpCode {
		return auth.Identity{}, errors.New("bad code")
	}
	return auth.Identity{UserID: userID, Email: appEmail, SessionID: workosSID}, nil
}

func (f *fakeIdP) LogoutURL(sessionID, returnTo string) (string, error) {
	f.logouts = append(f.logouts, sessionID)
	f.returns = append(f.returns, returnTo)
	if f.logoutErr != nil {
		return "", f.logoutErr
	}
	return logoutURL + "?" + url.Values{"session_id": {sessionID}, "return_to": {returnTo}}.Encode(), nil
}

// memAccounts is the accounts and sessions tables in memory, recording
// the WorkOS session of each site session made.
type memAccounts struct {
	acct    auth.Account
	created []string
}

func (m *memAccounts) UpsertAccount(_ context.Context, id auth.Identity) (auth.Account, error) {
	m.acct = auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000b2"), WorkOSUserID: id.UserID, Email: id.Email}
	return m.acct, nil
}

func (m *memAccounts) CreateSession(_ context.Context, _ uuid.UUID, _ []byte, sid, _ string, _ time.Time) error {
	m.created = append(m.created, sid)
	return nil
}

func (m *memAccounts) DeleteSession(context.Context, []byte) (string, error) { return "", nil }

func (m *memAccounts) UpdateAccount(ctx context.Context, _ uuid.UUID, _ *string, also func(context.Context, pgx.Tx) error) (auth.Account, error) {
	if also != nil {
		if err := also(ctx, nil); err != nil {
			return auth.Account{}, err
		}
	}
	return m.acct, nil
}

// A fixed PKCE pair, the challenge computed apart from this code (Python's
// hashlib and base64): the app keeps the verifier and sends the S256
// challenge on /auth/login.
const (
	appVerifier  = "dBjftJeZ4CVP-mJ92K9F_dRwOR6lh1NcvnNyJRVKRQ4"
	appChallenge = "8Gupdd4T5YR22GTKmsYs9odoxLTD8iuFKqtpc8YlXEU"
)

// appLogin is an app's /auth/login query: its client, the app link and
// the S256 challenge.
func appLogin(client string) string {
	return url.Values{
		"client": {client}, "return_to": {appLink},
		"code_challenge": {appChallenge}, "code_challenge_method": {"S256"},
	}.Encode()
}

// memCodes records the codes the callback asked for.
type memCodes struct {
	kinds      []auth.DeviceKind
	challenges []string
	sids       []string
}

func (m *memCodes) AppCode(_ context.Context, _ uuid.UUID, kind auth.DeviceKind, challenge, sid string) (string, error) {
	m.kinds = append(m.kinds, kind)
	m.challenges = append(m.challenges, challenge)
	m.sids = append(m.sids, sid)
	return "acorn amber anchor apple arch atlas", nil
}

// hasSessionCookie reports whether an answer set a live site session.
func hasSessionCookie(w *httptest.ResponseRecorder) bool {
	for _, c := range w.Result().Cookies() {
		if c.Name == auth.SessionCookie && c.Value != "" && c.MaxAge >= 0 {
			return true
		}
	}
	return false
}

func newAuthHandler(t *testing.T, store auth.AccountStore, codes auth.AppCodes) *auth.Handler {
	t.Helper()
	sessions, err := auth.NewSessions(config.Session{CookiePassword: bearerTestPassword}, 0, &fakeSessions{}, fixedNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	sealer, err := auth.NewStateSealer(bearerTestPassword)
	if err != nil {
		t.Fatal(err)
	}
	return &auth.Handler{
		Store: store, Sessions: sessions, IdP: &fakeIdP{}, PublicBaseURL: siteURL, StateSealer: sealer,
		AppCodes: codes, Now: fixedNow, Log: quietLog(),
	}
}

func serve(h http.HandlerFunc, target string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func routeHandler(t *testing.T, h *auth.Handler, path string) http.HandlerFunc {
	t.Helper()
	for _, rt := range h.Routes() {
		if rt.Path == path {
			return rt.Handler
		}
	}
	t.Fatalf("no route %s", path)
	return nil
}

// signIn runs /auth/login with query, then /auth/callback with the state
// it sealed, and returns the callback's answer.
func signIn(t *testing.T, h *auth.Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	login := serve(routeHandler(t, h, "/auth/login"), "/auth/login?"+query, nil)
	if login.Code != http.StatusFound {
		t.Fatalf("login %q: %d %s", query, login.Code, login.Body)
	}
	to, err := url.Parse(login.Header().Get("Location"))
	if err != nil || !strings.HasPrefix(to.String(), idpURL) {
		t.Fatalf("login went to %q", login.Header().Get("Location"))
	}
	target := "/auth/callback?code=" + idpCode + "&state=" + url.QueryEscape(to.Query().Get("state"))
	return serve(routeHandler(t, h, "/auth/callback"), target, login.Result().Cookies())
}

// The web's sign-in is unchanged: no client, a path to come back to, a
// 302 there, a site session kept with its WorkOS session and issued as
// the cookie, and no pairing code asked for.
func TestWebSignInUnchanged(t *testing.T) {
	codes := &memCodes{}
	accounts := &memAccounts{}
	h := newAuthHandler(t, accounts, codes)
	cases := map[string]string{
		"return_to=%2Fleague%2Fabc":               siteURL + "/league/abc",
		"return_to=https%3A%2F%2Fevil.example%2F": siteURL + "/",
		"": siteURL + "/",
	}
	for query, want := range cases {
		w := signIn(t, h, query)
		if w.Code != http.StatusFound || w.Header().Get("Location") != want {
			t.Fatalf("%q: %d to %q, want %q", query, w.Code, w.Header().Get("Location"), want)
		}
		if !hasSessionCookie(w) {
			t.Fatalf("%q: no session cookie", query)
		}
	}
	if len(accounts.created) != len(cases) || accounts.created[0] != workosSID {
		t.Fatalf("site sessions made: %v", accounts.created)
	}
	if len(codes.kinds) != 0 {
		t.Fatalf("the web sign-in minted pairing codes: %v", codes.kinds)
	}
}

// queuedUsers is the deleted accounts' WorkOS users still queued; err
// fails every read.
type queuedUsers struct {
	users map[string]bool
	err   error
}

func (q queuedUsers) Queued(_ context.Context, id string) (bool, error) { return q.users[id], q.err }

// A sign-in as a WorkOS user whose account was deleted here, still queued
// for the provider's delete (Lane 233), is refused for the web and the
// apps alike: no account made, no session, no pairing code, the problem
// page. A failed read refuses too. Another user signs in as before.
func TestSignInRefusedWhileTheAccountIsBeingDeleted(t *testing.T) {
	for name, queue := range map[string]queuedUsers{
		"queued":      {users: map[string]bool{userID: true}},
		"read failed": {err: errors.New("db down")},
	} {
		for _, query := range []string{"return_to=%2Faccount", appLogin("ios")} {
			codes, accounts := &memCodes{}, &memAccounts{}
			h := newAuthHandler(t, accounts, codes)
			h.Deleting = queue
			w := signIn(t, h, query)
			if w.Code != http.StatusFound || w.Header().Get("Location") != siteURL+"/sign-in/problem" {
				t.Fatalf("%s %q: %d to %q", name, query, w.Code, w.Header().Get("Location"))
			}
			if accounts.acct.WorkOSUserID != "" || len(accounts.created) != 0 || hasSessionCookie(w) || len(codes.kinds) != 0 {
				t.Fatalf("%s %q: an account, session or code was made", name, query)
			}
		}
	}
	h := newAuthHandler(t, &memAccounts{}, &memCodes{})
	h.Deleting = queuedUsers{users: map[string]bool{"user_someone_else": true}}
	if w := signIn(t, h, "return_to=%2Faccount"); w.Code != http.StatusFound || !hasSessionCookie(w) {
		t.Fatalf("another user's sign-in: %d, cookie %v", w.Code, hasSessionCookie(w))
	}
}

// An app's sign-in makes no site session (B212): no session row, no
// session cookie, and the WorkOS session goes on the pairing code to the
// device instead.
func TestAppSignInMakesNoSiteSession(t *testing.T) {
	for _, client := range []string{"ios", "android"} {
		codes := &memCodes{}
		accounts := &memAccounts{}
		h := newAuthHandler(t, accounts, codes)
		w := signIn(t, h, appLogin(client))
		if w.Code != http.StatusSeeOther {
			t.Fatalf("%s: %d %q", client, w.Code, w.Header().Get("Location"))
		}
		if len(accounts.created) != 0 {
			t.Fatalf("%s: an app sign-in made site sessions %v", client, accounts.created)
		}
		if hasSessionCookie(w) {
			t.Fatalf("%s: an app sign-in set a session cookie", client)
		}
		if len(codes.sids) != 1 || codes.sids[0] != workosSID {
			t.Fatalf("%s: codes carried WorkOS sessions %v", client, codes.sids)
		}
	}
}

// An app's sign-in comes back to the app link with a pairing code for
// its kind and the client named, by 303, and the code is minted under
// the challenge the app sent.
func TestAppSignInRedirectsToTheAppLink(t *testing.T) {
	for _, client := range []string{"ios", "android"} {
		codes := &memCodes{}
		h := newAuthHandler(t, &memAccounts{}, codes)
		bare := url.Values{"client": {client}, "code_challenge": {appChallenge}, "code_challenge_method": {"S256"}}.Encode()
		for _, query := range []string{appLogin(client), bare} {
			w := signIn(t, h, query)
			to, err := url.Parse(w.Header().Get("Location"))
			if w.Code != http.StatusSeeOther || err != nil {
				t.Fatalf("%q: %d to %q", query, w.Code, w.Header().Get("Location"))
			}
			if got := to.Scheme + "://" + to.Host + to.Path; got != appLink {
				t.Fatalf("%q came back to %q", query, got)
			}
			if to.Query().Get("code") != "acorn amber anchor apple arch atlas" || to.Query().Get("client") != client {
				t.Fatalf("%q: query %v", query, to.Query())
			}
		}
		if len(codes.kinds) != 2 || string(codes.kinds[0]) != client {
			t.Fatalf("%s: codes minted for %v", client, codes.kinds)
		}
		if codes.challenges[0] != appChallenge || codes.challenges[1] != appChallenge {
			t.Fatalf("%s: codes minted under %v", client, codes.challenges)
		}
	}
}

// An app's sign-in refuses a client word but the two apps', a return but
// the app link, and a missing or malformed S256 challenge, with the API's
// own 400 naming the field at fault, before AuthKit is ever asked.
func TestAppSignInRefusesForeignReturns(t *testing.T) {
	h := newAuthHandler(t, &memAccounts{}, &memCodes{})
	with := func(change map[string]string) string {
		q, _ := url.ParseQuery(appLogin("ios"))
		for k, v := range change {
			if v == "" {
				q.Del(k)
				continue
			}
			q.Set(k, v)
		}
		return q.Encode()
	}
	for query, field := range map[string]string{
		with(map[string]string{"return_to": "https://evil.example/"}):                             "return_to",
		with(map[string]string{"return_to": "/app/signed-in"}):                                    "return_to",
		with(map[string]string{"client": "android", "return_to": appLink + "?x=1"}):               "return_to",
		with(map[string]string{"return_to": "https://trycommish.app.evil.example/app/signed-in"}): "return_to",
		with(map[string]string{"client": "extension"}):                                            "client",
		with(map[string]string{"client": "web"}):                                                  "client",
		with(map[string]string{"client": "IOS"}):                                                  "client",
		with(map[string]string{"code_challenge": ""}):                                             "code_challenge",
		with(map[string]string{"code_challenge": appChallenge[:42]}):                              "code_challenge",
		with(map[string]string{"code_challenge": appChallenge[:42] + "="}):                        "code_challenge",
		with(map[string]string{"code_challenge_method": ""}):                                      "code_challenge_method",
		with(map[string]string{"code_challenge_method": "plain"}):                                 "code_challenge_method",
	} {
		w := serve(routeHandler(t, h, "/auth/login"), "/auth/login?"+query, nil)
		var env struct {
			Error struct {
				Code   string            `json:"code"`
				Fields map[string]string `json:"fields"`
			} `json:"error"`
		}
		if w.Code != http.StatusBadRequest || json.Unmarshal(w.Body.Bytes(), &env) != nil || env.Error.Code != httpx.CodeInvalid {
			t.Fatalf("%q: %d %s", query, w.Code, w.Body)
		}
		if _, ok := env.Error.Fields[field]; !ok || len(env.Error.Fields) != 1 {
			t.Fatalf("%q named %v, want %s", query, env.Error.Fields, field)
		}
		if len(w.Result().Cookies()) != 0 {
			t.Fatalf("%q set a state cookie", query)
		}
	}
}

// appPairing is the callback, the device routes and one signed-in route
// against the database, with one fake WorkOS for the sign-in and the
// sign-out, mounted the way the api mounts them.
type appPairing struct {
	t        *testing.T
	pool     *pgxpool.Pool
	accounts *auth.Store
	svc      *devices.Service
	h        *auth.Handler
	idp      *fakeIdP
	mux      *http.ServeMux
}

func newAppPairing(t *testing.T) appPairing {
	t.Helper()
	pool := dbtest.Pool(t)
	accounts := &auth.Store{Pool: pool}
	store := &devices.Store{Pool: pool}
	bearer, err := auth.NewBearer(bearerTestPassword, 0, store, fixedNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	codeKey, err := auth.DeriveKey(bearerTestPassword, devices.PurposeCodes)
	if err != nil {
		t.Fatal(err)
	}
	idp := &fakeIdP{}
	svc := &devices.Service{Store: store, Tokens: bearer, CodeKey: codeKey, Now: fixedNow, Log: quietLog(),
		IdP: idp, SignedOutURL: siteURL + auth.SignedOutPath}
	h := newAuthHandler(t, accounts, svc)
	h.IdP = idp
	sessions, err := auth.NewSessions(config.Session{CookiePassword: bearerTestPassword}, 0, accounts, fixedNow, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	routes := append(svc.Routes(), httpx.Route{Method: http.MethodGet, Path: "/leagues/attached", Access: httpx.SignedIn,
		Limit: httpx.PerMinute(60), Handler: func(w http.ResponseWriter, r *http.Request) { httpx.WriteOK(w, r, 200, nil) }})
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, bearer, fixedNow); err != nil {
		t.Fatal(err)
	}
	return appPairing{t: t, pool: pool, accounts: accounts, svc: svc, h: h, idp: idp, mux: mux}
}

// signInCode signs an app in through the callback and answers the code
// it came back to the app link with.
func (p appPairing) signInCode(client string) string {
	w := signIn(p.t, p.h, appLogin(client))
	to, err := url.Parse(w.Header().Get("Location"))
	if w.Code != http.StatusSeeOther || err != nil {
		p.t.Fatalf("callback: %d %q", w.Code, w.Header().Get("Location"))
	}
	return to.Query().Get("code")
}

// call sends a request through the mounted routes with an optional
// device token and answers the status and the envelope's data.
func (p appPairing) call(method, path, token string, body any) (int, json.RawMessage) {
	var buf strings.Builder
	if body != nil {
		raw, _ := json.Marshal(body)
		buf.Write(raw)
	}
	r := httptest.NewRequest(method, path, strings.NewReader(buf.String()))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	p.mux.ServeHTTP(rec, r)
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env.Data
}

// pair trades code for an iOS device token, with verifier when it is set.
func (p appPairing) pair(code, verifier string) (int, apitypes.Paired) {
	kind := apitypes.DeviceKindIos
	in := apitypes.PairInput{Code: code, Kind: &kind}
	if verifier != "" {
		in.CodeVerifier = &verifier
	}
	status, data := p.call(http.MethodPost, "/devices/pair", "", in)
	var paired apitypes.Paired
	_ = json.Unmarshal(data, &paired)
	return status, paired
}

// signOut unpairs the device as an app signs itself out: its own token,
// its own id.
func (p appPairing) signOut(paired apitypes.Paired) apitypes.DeviceSignOut {
	status, data := p.call(http.MethodDelete, "/devices/"+paired.Device.Id.String(), paired.Token, nil)
	var out apitypes.DeviceSignOut
	if status != http.StatusOK || json.Unmarshal(data, &out) != nil || !strings.Contains(string(data), `"url"`) {
		p.t.Fatalf("sign out: %d %s", status, data)
	}
	return out
}

func (p appPairing) count(query string, args ...any) int {
	var n int
	if err := p.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		p.t.Fatal(err)
	}
	return n
}

// End to end against the devices table: the code the callback hands the
// app pairs one iOS device once, and only with the verifier behind the
// challenge the sign-in began with; the token it mints opens a signed-in
// route.
func TestAppSignInCodePairsOnce(t *testing.T) {
	p := newAppPairing(t)
	code := p.signInCode("ios")
	// Someone holding the link but not the app: no verifier, a wrong one.
	// Each is refused and spends nothing, so the app still pairs.
	for _, verifier := range []string{"", strings.Repeat("a", 43)} {
		if status, paired := p.pair(code, verifier); status != http.StatusBadRequest || paired.Token != "" {
			t.Fatalf("pair with verifier %q: %d", verifier, status)
		}
	}
	status, paired := p.pair(code, appVerifier)
	if status != http.StatusCreated || paired.Device.Kind == nil || *paired.Device.Kind != apitypes.DeviceKindIos {
		t.Fatalf("pair: %d %+v", status, paired.Device)
	}
	if !slices.Contains(paired.Device.Scopes, apitypes.DeviceScopeSession) {
		t.Fatalf("an iOS device without the session scope: %v", paired.Device.Scopes)
	}
	if status, _ := p.pair(code, appVerifier); status != http.StatusBadRequest {
		t.Fatalf("the code paired twice: %d", status)
	}
	if status, _ := p.call(http.MethodGet, "/leagues/attached", paired.Token, nil); status != http.StatusOK {
		t.Fatalf("the app's token on a signed-in route: %d", status)
	}
}

// B212: an app's sign-in leaves no site session on the server, its device
// keeps the sign-in's WorkOS session, and the app signing itself out is
// answered the WorkOS logout URL for that session, returning to the
// site's signed-out page. The token is dead from the next request.
func TestAppSignOutAnswersTheWorkOSLogout(t *testing.T) {
	p := newAppPairing(t)
	status, paired := p.pair(p.signInCode("ios"), appVerifier)
	if status != http.StatusCreated {
		t.Fatalf("pair: %d", status)
	}
	if n := p.count(`select count(*) from app.sessions`); n != 0 {
		t.Fatalf("an app sign-in left %d site sessions", n)
	}
	if n := p.count(`select count(*) from app.devices where id = $1 and workos_session_id = $2`, paired.Device.Id, workosSID); n != 1 {
		t.Fatal("the device did not keep the sign-in's WorkOS session")
	}

	out := p.signOut(paired)
	want := logoutURL + "?" + url.Values{"session_id": {workosSID}, "return_to": {siteURL + "/"}}.Encode()
	if out.Url == nil || *out.Url != want {
		t.Fatalf("sign out url %v, want %s", out.Url, want)
	}
	if !slices.Equal(p.idp.logouts, []string{workosSID}) || !slices.Equal(p.idp.returns, []string{siteURL + "/"}) {
		t.Fatalf("WorkOS asked to end %v returning to %v", p.idp.logouts, p.idp.returns)
	}
	if status, _ := p.call(http.MethodGet, "/leagues/attached", paired.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("a signed-out app token: %d", status)
	}
	if n := p.count(`select count(*) from app.devices where workos_session_id is not null`); n != 0 {
		t.Fatalf("%d revoked devices kept their WorkOS session", n)
	}
}

// When WorkOS cannot build the logout URL, the sign-out still unpairs:
// 200 with url null (the failure is logged), and the token is dead from
// the next request. The device is revoked before the URL is asked for.
func TestAppSignOutWhenTheLogoutURLFails(t *testing.T) {
	p := newAppPairing(t)
	p.idp.logoutErr = errors.New("workos: incomplete arguments")
	status, paired := p.pair(p.signInCode("ios"), appVerifier)
	if status != http.StatusCreated {
		t.Fatalf("pair: %d", status)
	}
	if out := p.signOut(paired); out.Url != nil {
		t.Fatalf("a failed logout URL answered %q", *out.Url)
	}
	if !slices.Equal(p.idp.logouts, []string{workosSID}) {
		t.Fatalf("WorkOS asked to end %v", p.idp.logouts)
	}
	if status, _ := p.call(http.MethodGet, "/leagues/attached", paired.Token, nil); status != http.StatusUnauthorized {
		t.Fatalf("the token after a sign-out whose URL failed: %d", status)
	}
}

// A device paired before the API kept WorkOS sessions (B212's old
// phones) signs out with url null, and WorkOS is never asked; an app
// unpairing another device is answered data null, as the account page is.
func TestAppSignOutWithoutAWorkOSSession(t *testing.T) {
	p := newAppPairing(t)
	acct, err := p.accounts.UpsertAccount(context.Background(), auth.Identity{UserID: userID, Email: appEmail})
	if err != nil {
		t.Fatal(err)
	}
	pairOld := func() apitypes.Paired {
		code, err := p.svc.AppCode(context.Background(), acct.ID, auth.KindIOS, appChallenge, "")
		if err != nil {
			t.Fatal(err)
		}
		status, paired := p.pair(code, appVerifier)
		if status != http.StatusCreated {
			t.Fatalf("pair: %d", status)
		}
		return paired
	}
	old, other := pairOld(), pairOld()

	status, data := p.call(http.MethodDelete, "/devices/"+other.Device.Id.String(), old.Token, nil)
	if status != http.StatusOK || string(data) != "null" {
		t.Fatalf("unpairing another device: %d %s", status, data)
	}
	if out := p.signOut(old); out.Url != nil {
		t.Fatalf("an old phone's sign out answered %q", *out.Url)
	}
	if len(p.idp.logouts) != 0 {
		t.Fatalf("WorkOS asked to end %v", p.idp.logouts)
	}
}

// The S256 challenge is base64url(SHA-256(verifier)) with no padding,
// checked against a pair computed apart from this code.
func TestPKCEChallenge(t *testing.T) {
	if got := auth.PKCEChallenge(appVerifier); got != appChallenge {
		t.Fatalf("challenge %q", got)
	}
	for _, v := range []string{appVerifier, strings.Repeat("~", 128), "a-b.c_d~" + strings.Repeat("0", 35)} {
		if !auth.ValidVerifier(v) {
			t.Fatalf("%q refused", v)
		}
	}
	for _, v := range []string{"", strings.Repeat("a", 42), strings.Repeat("a", 129), appVerifier[:42] + "+"} {
		if auth.ValidVerifier(v) {
			t.Fatalf("%q accepted", v)
		}
	}
}
