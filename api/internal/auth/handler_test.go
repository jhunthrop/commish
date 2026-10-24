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

// fakeIdP is AuthKit: it hands the state back in its URL and signs in
// one member for any code.
type fakeIdP struct{}

func (fakeIdP) AuthorizationURL(state string, _ auth.Screen) (string, error) {
	return idpURL + "?state=" + url.QueryEscape(state), nil
}

func (fakeIdP) Authenticate(_ context.Context, code, _, _ string) (auth.Identity, error) {
	if code != idpCode {
		return auth.Identity{}, errors.New("bad code")
	}
	return auth.Identity{UserID: userID, Email: appEmail, SessionID: "session_1"}, nil
}

func (fakeIdP) LogoutURL(_, returnTo string) (string, error) { return returnTo, nil }

// memAccounts is the accounts and sessions tables in memory.
type memAccounts struct{ acct auth.Account }

func (m *memAccounts) UpsertAccount(_ context.Context, id auth.Identity) (auth.Account, error) {
	m.acct = auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000b2"), WorkOSUserID: id.UserID, Email: id.Email}
	return m.acct, nil
}

func (m *memAccounts) CreateSession(context.Context, uuid.UUID, []byte, string, string, time.Time) error {
	return nil
}

func (m *memAccounts) DeleteSession(context.Context, []byte) (string, error) { return "", nil }

func (m *memAccounts) SetHandle(context.Context, uuid.UUID, string) (auth.Account, error) {
	return m.acct, nil
}

// memCodes records the codes the callback asked for.
type memCodes struct {
	kinds []auth.DeviceKind
}

func (m *memCodes) AppCode(_ context.Context, _ uuid.UUID, kind auth.DeviceKind) (string, error) {
	m.kinds = append(m.kinds, kind)
	return "acorn amber anchor apple arch atlas", nil
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
		Store: store, Sessions: sessions, IdP: fakeIdP{}, PublicBaseURL: siteURL, StateSealer: sealer,
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
// 302 there and no pairing code asked for.
func TestWebSignInUnchanged(t *testing.T) {
	codes := &memCodes{}
	h := newAuthHandler(t, &memAccounts{}, codes)
	for query, want := range map[string]string{
		"return_to=%2Fleague%2Fabc":               siteURL + "/league/abc",
		"return_to=https%3A%2F%2Fevil.example%2F": siteURL + "/",
		"": siteURL + "/",
	} {
		w := signIn(t, h, query)
		if w.Code != http.StatusFound || w.Header().Get("Location") != want {
			t.Fatalf("%q: %d to %q, want %q", query, w.Code, w.Header().Get("Location"), want)
		}
	}
	if len(codes.kinds) != 0 {
		t.Fatalf("the web sign-in minted pairing codes: %v", codes.kinds)
	}
}

// An app's sign-in comes back to the app link with a pairing code for
// its kind and the client named, by 303.
func TestAppSignInRedirectsToTheAppLink(t *testing.T) {
	for _, client := range []string{"ios", "android"} {
		codes := &memCodes{}
		h := newAuthHandler(t, &memAccounts{}, codes)
		for _, query := range []string{"client=" + client + "&return_to=" + url.QueryEscape(appLink), "client=" + client} {
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
	}
}

// An app's sign-in refuses anything but the app link to come back to,
// and any client word but the two apps', with the API's own 400 before
// AuthKit is ever asked.
func TestAppSignInRefusesForeignReturns(t *testing.T) {
	h := newAuthHandler(t, &memAccounts{}, &memCodes{})
	for _, query := range []string{
		"client=ios&return_to=" + url.QueryEscape("https://evil.example/"),
		"client=ios&return_to=" + url.QueryEscape("/app/signed-in"),
		"client=android&return_to=" + url.QueryEscape(appLink+"?x=1"),
		"client=ios&return_to=" + url.QueryEscape("https://trycommish.app.evil.example/app/signed-in"),
		"client=extension",
		"client=web",
		"client=IOS",
	} {
		w := serve(routeHandler(t, h, "/auth/login"), "/auth/login?"+query, nil)
		var env struct {
			OK    bool `json:"ok"`
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if w.Code != http.StatusBadRequest || json.Unmarshal(w.Body.Bytes(), &env) != nil || env.Error.Code != httpx.CodeInvalid {
			t.Fatalf("%q: %d %s", query, w.Code, w.Body)
		}
		if len(w.Result().Cookies()) != 0 {
			t.Fatalf("%q set a state cookie", query)
		}
	}
}

// End to end against the devices table: the code the callback hands the
// app pairs one iOS device once, carrying the session scope, and the
// token it mints opens a signed-in route.
func TestAppSignInCodePairsOnce(t *testing.T) {
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
	svc := &devices.Service{Store: store, Tokens: bearer, CodeKey: codeKey, Now: fixedNow, Log: quietLog()}
	h := newAuthHandler(t, accounts, svc)

	w := signIn(t, h, "client=ios&return_to="+url.QueryEscape(appLink))
	to, err := url.Parse(w.Header().Get("Location"))
	if w.Code != http.StatusSeeOther || err != nil {
		t.Fatalf("callback: %d %q", w.Code, w.Header().Get("Location"))
	}
	code := to.Query().Get("code")

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
	pair := func() (int, apitypes.Paired) {
		kind := apitypes.DeviceKindIos
		body, _ := json.Marshal(apitypes.PairInput{Code: code, Kind: &kind})
		r := httptest.NewRequest(http.MethodPost, "/devices/pair", strings.NewReader(string(body)))
		r.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, r)
		var env struct {
			Data apitypes.Paired `json:"data"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		return rec.Code, env.Data
	}
	status, paired := pair()
	if status != http.StatusCreated || paired.Device.Kind == nil || *paired.Device.Kind != apitypes.DeviceKindIos {
		t.Fatalf("pair: %d %+v", status, paired.Device)
	}
	if !slices.Contains(paired.Device.Scopes, apitypes.DeviceScopeSession) {
		t.Fatalf("an iOS device without the session scope: %v", paired.Device.Scopes)
	}
	if status, _ := pair(); status != http.StatusBadRequest {
		t.Fatalf("the code paired twice: %d", status)
	}
	r := httptest.NewRequest(http.MethodGet, "/leagues/attached", nil)
	r.Header.Set("Authorization", "Bearer "+paired.Token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("the app's token on a signed-in route: %d %s", rec.Code, rec.Body)
	}
}
