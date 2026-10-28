// Package mfltest is a stand-in for MyFantasyLeague's member API in
// tests: the login, the member's exports and the lineup import, answered
// from the documented shapes in api/internal/mfl/testdata (see its
// PROVENANCE.txt). It records what each request carried so a test can
// check a password never rode in a URL and a session went only where it
// should.
package mfltest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/mfl"
)

// The fixtures' values.
const (
	// Session is the MFL_USER_ID login-ok.xml answers.
	Session = "aGVsbG8ubWZsPTEyMzQ1Njc4OTAxMg=="
	// Password is the one password the stand-in accepts.
	Password = "correct horse battery staple"
	// Username is the member's MyFantasyLeague username.
	Username = "founder@example.com"
	// LeagueID, Season, Week and Franchise are the member's league, its
	// season and week, and their franchise in it.
	LeagueID  = "10010"
	Season    = 2026
	Week      = 7
	Franchise = 3
)

// The roster's players by role in the swap.
const (
	QB       = "13116"
	RBStarts = "15284"
	RBBench  = "13604"
	WR1      = "15287"
	WR2      = "12611"
	WRBench  = "15757"
	OnIR     = "16213"
)

// Testdata is a fixture's bytes.
func Testdata(t testing.TB, name string) []byte {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	b, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Server is the stand-in.
type Server struct {
	URL string

	mu sync.Mutex
	t  testing.TB
	// ImportStatus and ImportAnswer are the import's answer: its status and
	// a fixture name (empty for no body).
	ImportStatus int
	ImportAnswer string
	// Applies is whether an import changes what liveScoring answers.
	Applies bool
	applied bool
	// Expires is the session cookie's expiry on login, zero for none.
	Expires time.Time
	// SessionRefused makes every member read answer the login refusal.
	SessionRefused bool
	// RefusalWords is a member read's refusal, "" for the default.
	RefusalWords string
	// MyLeagues is the myleagues fixture.
	MyLeagues string
	// Live is the liveScoring fixture before an import applies.
	Live string

	loginQueries []string
	imports      []url.Values
	importQuery  []string
	cookies      []string
}

// New starts the stand-in; it closes with the test.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{t: t, ImportStatus: http.StatusOK, ImportAnswer: "import-ok.xml", Applies: true, MyLeagues: "myleagues.json",
		Live: "live-member.json"}
	srv := httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(srv.Close)
	s.URL = srv.URL
	return s
}

// Client is an MFL client on the stand-in: no sleeping between turns, and
// a clock that moves two seconds a read so no turn waits.
func (s *Server) Client() *mfl.Client {
	c := mfl.New()
	c.BaseURL = s.URL
	var mu sync.Mutex
	now := time.Date(2026, 10, 18, 15, 0, 0, 0, time.UTC)
	c.Now = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		now = now.Add(2 * time.Second)
		return now
	}
	c.Sleep = func(context.Context, time.Duration) error { return nil }
	return c
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "text/plain")
	switch r.URL.Path {
	case "/2026/login":
		s.login(w, r)
	case "/2026/import":
		s.importLineup(w, r)
	case "/fflnetdynamic2026/mfl_status.json":
		_, _ = w.Write(Testdata(s.t, "status-member.json"))
	case "/2026/export":
		s.export(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	s.loginQueries = append(s.loginQueries, r.URL.RawQuery)
	if r.Method != http.MethodPost || r.ParseForm() != nil || r.PostForm.Get("USERNAME") != Username || r.PostForm.Get("PASSWORD") != Password {
		_, _ = w.Write(Testdata(s.t, "login-refused.xml"))
		return
	}
	cookie := &http.Cookie{Name: mfl.SessionCookie, Value: Session, Path: "/", Domain: ".myfantasyleague.com"}
	if !s.Expires.IsZero() {
		cookie.Expires = s.Expires
	}
	http.SetCookie(w, cookie)
	_, _ = w.Write(Testdata(s.t, "login-ok.xml"))
}

// member reports a request carrying the session, and answers the refusal
// for one that does not (or for every one, SessionRefused).
func (s *Server) member(w http.ResponseWriter, r *http.Request) bool {
	s.cookies = append(s.cookies, r.Header.Get("Cookie"))
	c, err := r.Cookie(mfl.SessionCookie)
	if err != nil || c.Value != Session || s.SessionRefused {
		words := s.RefusalWords
		if words == "" {
			words = "You must be logged in to view this page."
		}
		b, _ := json.Marshal(map[string]map[string]string{"error": {"$t": words}})
		_, _ = w.Write(b)
		return false
	}
	return true
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !s.member(w, r) {
		return
	}
	switch q.Get("TYPE") {
	case "myleagues":
		_, _ = w.Write(Testdata(s.t, s.MyLeagues))
	case "league":
		_, _ = w.Write(Testdata(s.t, "league-member.json"))
	case "rosters":
		_, _ = w.Write(Testdata(s.t, "rosters-member.json"))
	case "pendingTrades":
		_, _ = w.Write(Testdata(s.t, "pending-trades-member.json"))
	case "liveScoring":
		if s.applied {
			_, _ = w.Write(Testdata(s.t, "live-member-after.json"))
			return
		}
		_, _ = w.Write(Testdata(s.t, s.Live))
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) importLineup(w http.ResponseWriter, r *http.Request) {
	s.importQuery = append(s.importQuery, r.URL.RawQuery)
	if r.Method != http.MethodPost || r.ParseForm() != nil {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.imports = append(s.imports, r.PostForm)
	if !s.member(w, r) {
		return
	}
	s.applied = s.Applies
	w.WriteHeader(s.ImportStatus)
	if s.ImportAnswer != "" {
		_, _ = w.Write(Testdata(s.t, s.ImportAnswer))
	}
}

// Imports is every import's form, in order.
func (s *Server) Imports() []url.Values {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]url.Values(nil), s.imports...)
}

// ImportQueries is every import's URL query, in order.
func (s *Server) ImportQueries() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.importQuery...)
}

// LoginQueries is every login's URL query, in order.
func (s *Server) LoginQueries() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.loginQueries...)
}

// Cookies is the Cookie header of every member request, in order.
func (s *Server) Cookies() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.cookies...)
}

// Set changes the stand-in under its lock.
func (s *Server) Set(fn func(s *Server)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s)
}
