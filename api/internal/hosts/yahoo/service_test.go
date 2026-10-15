package yahoo

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

type memStates struct{ byState map[string]Flight }

func (s *memStates) Start(_ context.Context, f Flight, state string, _ time.Time) error {
	if s.byState == nil {
		s.byState = map[string]Flight{}
	}
	s.byState[state] = f
	return nil
}

func (s *memStates) Finish(_ context.Context, state string, _ time.Time) (Flight, error) {
	f, ok := s.byState[state]
	if !ok {
		return Flight{}, ErrNoState
	}
	delete(s.byState, state)
	return f, nil
}

type fakeExchanger struct {
	refuse   bool
	verifier string
}

func (f *fakeExchanger) AuthorizeURL(state, challenge string) string {
	return "https://api.login.yahoo.com/oauth2/request_auth?" + url.Values{"state": {state}, "code_challenge": {challenge}}.Encode()
}

func (f *fakeExchanger) Exchange(_ context.Context, _, verifier string, now time.Time) (Tokens, error) {
	f.verifier = verifier
	if f.refuse {
		return Tokens{}, ErrRefused
	}
	return Tokens{Access: "a", Refresh: "r", Expiry: now.Add(time.Hour)}, nil
}

type putStore struct {
	put     []uuid.UUID
	deleted int
}

func (p *putStore) Put(_ context.Context, accountID uuid.UUID, host string, _ hosts.Sealed, _ time.Time) (hosts.Connection, error) {
	p.put = append(p.put, accountID)
	return hosts.Connection{AccountID: accountID, Host: host, Status: hosts.StatusConnected}, nil
}

func (p *putStore) Delete(context.Context, uuid.UUID, string) error {
	p.deleted++
	if p.deleted > 1 {
		return hosts.ErrNotConnected
	}
	return nil
}

func service(t *testing.T) (*Service, *memStates, *fakeExchanger, *putStore) {
	t.Helper()
	states, ex, store := &memStates{}, &fakeExchanger{}, &putStore{}
	return &Service{
		Enabled: true, OAuth: ex, States: states, Store: store, Vault: testVault(t),
		PublicBaseURL: "https://trycommish.app", Now: time.Now, Log: quiet(),
	}, states, ex, store
}

func as(r *http.Request, id uuid.UUID) *http.Request {
	return r.WithContext(auth.WithAccount(r.Context(), auth.Account{ID: id}))
}

// startConnect asks for the authorize address as the account and answers
// the state it carries.
func startConnect(t *testing.T, s *Service, id uuid.UUID) string {
	t.Helper()
	return startConnectFrom(t, s, id, "")
}

// startConnectFrom starts a sign-in from a page, a body carrying it when set.
func startConnectFrom(t *testing.T, s *Service, id uuid.UUID, from string) string {
	t.Helper()
	w := httptest.NewRecorder()
	var in io.Reader = http.NoBody
	if from != "" {
		in = strings.NewReader(`{"return_to":"` + from + `"}`)
	}
	r := httptest.NewRequest(http.MethodPost, "/hosts/yahoo/connect", in)
	r.Header.Set("Content-Type", "application/json")
	s.connect(w, as(r, id))
	if w.Code != http.StatusOK {
		t.Fatalf("connect answered %d", w.Code)
	}
	var body struct {
		Data apitypes.Redirect `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(body.Data.Url)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("state")
}

// callback runs Yahoo's return and answers where it redirected.
func callback(t *testing.T, s *Service, query url.Values, who *uuid.UUID) *url.URL {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/hosts/yahoo/callback?"+query.Encode(), nil)
	if who != nil {
		r = as(r, *who)
	}
	w := httptest.NewRecorder()
	s.callback(w, r)
	if w.Code != http.StatusFound {
		t.Fatalf("callback answered %d", w.Code)
	}
	to, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if to.Scheme+"://"+to.Host != "https://trycommish.app" {
		t.Fatalf("redirected to %s, outside the site", to)
	}
	return to
}

func outcome(to *url.URL) string {
	q := to.Query()
	return strings.TrimSuffix(q.Get(paramOutcome)+" "+q.Get(paramWhy), " ")
}

// The whole sign-in: the state the account started, Yahoo's code, the
// verifier kept beside the state, and the tokens kept for that account.
func TestCallbackConnects(t *testing.T) {
	s, states, ex, store := service(t)
	me := uuid.New()
	state := startConnect(t, s, me)
	verifier := states.byState[state].Verifier
	to := callback(t, s, url.Values{"state": {state}, "code": {"the-code"}}, &me)
	if outcome(to) != outConnected || len(store.put) != 1 || store.put[0] != me || ex.verifier != verifier {
		t.Fatalf("outcome %q, put %v, verifier sent %q", outcome(to), store.put, ex.verifier)
	}
	// The state is used up.
	if to := callback(t, s, url.Values{"state": {state}, "code": {"the-code"}}, &me); outcome(to) != outRefused+" "+whyExpired {
		t.Fatalf("a used state: %q", outcome(to))
	}
}

// A state another account started never puts this browser's Yahoo on
// that account, and a browser signed out connects nobody.
func TestCallbackRefusesAnotherAccountsState(t *testing.T) {
	s, _, _, store := service(t)
	them, me := uuid.New(), uuid.New()
	state := startConnect(t, s, them)
	if to := callback(t, s, url.Values{"state": {state}, "code": {"c"}}, &me); outcome(to) != outRefused+" "+whySignedOut {
		t.Fatalf("another account's state: %q", outcome(to))
	}
	state = startConnect(t, s, me)
	if to := callback(t, s, url.Values{"state": {state}, "code": {"c"}}, nil); outcome(to) != outRefused+" "+whySignedOut {
		t.Fatalf("signed out: %q", outcome(to))
	}
	if len(store.put) != 0 {
		t.Fatalf("kept %v", store.put)
	}
}

// Every other end says why in a word the account page reads.
func TestCallbackOutcomes(t *testing.T) {
	s, _, ex, _ := service(t)
	me := uuid.New()
	state := startConnect(t, s, me)
	if to := callback(t, s, url.Values{"state": {state}, "error": {"access_denied"}}, &me); outcome(to) != outRefused+" "+whyDenied {
		t.Fatalf("denied: %q", outcome(to))
	}
	if to := callback(t, s, url.Values{"state": {"never-started"}, "code": {"c"}}, &me); outcome(to) != outRefused+" "+whyExpired {
		t.Fatalf("unknown state: %q", outcome(to))
	}
	ex.refuse = true
	state = startConnect(t, s, me)
	if to := callback(t, s, url.Values{"state": {state}, "code": {"c"}}, &me); outcome(to) != outRefused+" "+whyFailed {
		t.Fatalf("refused code: %q", outcome(to))
	}
	s.Enabled = false
	if to := callback(t, s, url.Values{}, &me); outcome(to) != outRefused+" "+whyOff {
		t.Fatalf("switched off: %q", outcome(to))
	}
}

type fakeLeagues struct{ err error }

func (f fakeLeagues) Leagues(context.Context, uuid.UUID) ([]MyLeague, error) {
	if f.err != nil {
		return nil, f.err
	}
	return []MyLeague{
		{LeagueID: "128934", Season: 2026, Name: "The Commish Classic", Teams: 10, ScoringType: "head", TeamName: "Gridiron Gurus"},
		{LeagueID: "55021", Season: 2026, Name: "Office Pool", Teams: 12, ScoringType: "odd"},
	}, nil
}

type fakeFollowed map[string]bool

func (f fakeFollowed) FollowedIDs(context.Context, uuid.UUID, string) (map[string]bool, error) {
	return f, nil
}

// The league list names size, scoring and whether each is followed; a
// connection Yahoo refused asks for a reconnect.
func TestLeagues(t *testing.T) {
	s, _, _, _ := service(t)
	s.Leagues, s.Followed = fakeLeagues{}, fakeFollowed{hosts.FollowKey("128934", 2026): true}
	w := httptest.NewRecorder()
	s.leagues(w, as(httptest.NewRequest(http.MethodGet, "/hosts/yahoo/leagues", nil), uuid.New()))
	var body struct {
		Data []apitypes.HostLeague `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Data) != 2 {
		t.Fatalf("%d: %s", w.Code, w.Body)
	}
	first, second := body.Data[0], body.Data[1]
	if !*first.Attached || *first.Teams != 10 || *first.ScoringType != "head to head" || first.TeamName != "Gridiron Gurus" {
		t.Fatalf("first: %+v", first)
	}
	if *second.Attached || second.ScoringType != nil {
		t.Fatalf("second: %+v", second)
	}
	for err, code := range map[error]int{ErrReconnect: http.StatusConflict, hosts.ErrNotConnected: http.StatusNotFound, errors.New("x"): http.StatusBadGateway} {
		s.Leagues = fakeLeagues{err: err}
		w := httptest.NewRecorder()
		s.leagues(w, as(httptest.NewRequest(http.MethodGet, "/hosts/yahoo/leagues", nil), uuid.New()))
		if w.Code != code {
			t.Fatalf("%v answered %d, want %d", err, w.Code, code)
		}
	}
}

func TestDisconnect(t *testing.T) {
	s, _, _, store := service(t)
	for _, want := range []int{http.StatusOK, http.StatusNotFound} {
		w := httptest.NewRecorder()
		hosts.Disconnect(s.Store, Host, s.Log)(w, as(httptest.NewRequest(http.MethodDelete, "/hosts/yahoo", nil), uuid.New()))
		if w.Code != want {
			t.Fatalf("disconnect %d answered %d", store.deleted, w.Code)
		}
	}
}

// Off, connecting answers that Yahoo is not open here.
func TestConnectOff(t *testing.T) {
	s, _, _, _ := service(t)
	s.Enabled = false
	w := httptest.NewRecorder()
	s.connect(w, as(httptest.NewRequest(http.MethodPost, "/hosts/yahoo/connect", nil), uuid.New()))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", w.Code)
	}
}

// A sign-in started from a league page returns there once connected; a
// return that is not a page on the site is refused at the start.
func TestCallbackReturnsToThePageItStartedFrom(t *testing.T) {
	s, _, _, _ := service(t)
	me := uuid.New()
	state := startConnectFrom(t, s, me, "/league/7b0c1f9e-1111-4a1a-9a1a-000000000001")
	to := callback(t, s, url.Values{"state": {state}, "code": {"c"}}, &me)
	if to.Path != "/league/7b0c1f9e-1111-4a1a-9a1a-000000000001" || outcome(to) != outConnected {
		t.Fatalf("returned to %s", to)
	}
	for _, bad := range []string{"//evil.example", "https://evil.example", "/a?b", "/../x"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/hosts/yahoo/connect", strings.NewReader(`{"return_to":"`+bad+`"}`))
		r.Header.Set("Content-Type", "application/json")
		s.connect(w, as(r, me))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("return to %q: %d", bad, w.Code)
		}
	}
	state = startConnect(t, s, me)
	if to := callback(t, s, url.Values{"state": {state}, "code": {"c"}}, &me); to.Path != "/account" {
		t.Fatalf("no return path: %s", to)
	}
}
