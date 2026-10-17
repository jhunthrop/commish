package mfl_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/mfl/mfltest"
)

// A login posts the two in the body, never the URL, and answers the
// session MyFantasyLeague handed back with the expiry its cookie states.
func TestLoginExchangesOnce(t *testing.T) {
	srv := mfltest.New(t)
	expires := time.Date(2027, 10, 18, 0, 0, 0, 0, time.UTC)
	srv.Set(func(s *mfltest.Server) { s.Expires = expires })
	sess, err := srv.Client().Login(context.Background(), mfltest.Season, mfltest.Username, mfltest.Password)
	if err != nil {
		t.Fatal(err)
	}
	if sess.UserID != mfltest.Session || !sess.Expires.Equal(expires) {
		t.Fatalf("session %v expires %v", sess.UserID == mfltest.Session, sess.Expires)
	}
	for _, q := range srv.LoginQueries() {
		if strings.Contains(q, "PASSWORD") || strings.Contains(q, "USERNAME") {
			t.Fatalf("the sign-in rode in the URL: %q", q)
		}
	}
	// No expiry stated is no expiry kept.
	srv.Set(func(s *mfltest.Server) { s.Expires = time.Time{} })
	sess, err = srv.Client().Login(context.Background(), mfltest.Season, mfltest.Username, mfltest.Password)
	if err != nil || !sess.Expires.IsZero() {
		t.Fatalf("%v %v", err, sess.Expires)
	}
}

// A refused login is ErrSignedOut, its words never in the error.
func TestLoginRefused(t *testing.T) {
	srv := mfltest.New(t)
	_, err := srv.Client().Login(context.Background(), mfltest.Season, mfltest.Username, "wrong")
	if !errors.Is(err, mfl.ErrSignedOut) || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("%v", err)
	}
	for _, bad := range [][2]string{{"", "x"}, {"x", ""}, {strings.Repeat("u", 200), "x"}} {
		if _, err := srv.Client().Login(context.Background(), mfltest.Season, bad[0], bad[1]); !errors.Is(err, mfl.ErrSignedOut) {
			t.Errorf("%d and %d characters answered %v", len(bad[0]), len(bad[1]), err)
		}
	}
	if n := len(srv.LoginQueries()); n != 1 {
		t.Fatalf("%d logins sent, want only the well-formed one", n)
	}
}

// A session never prints: not in a log, not as JSON, not with %v.
func TestSessionNeverPrints(t *testing.T) {
	s := mfl.Session{UserID: mfltest.Session}
	var logged strings.Builder
	slog.New(slog.NewTextHandler(&logged, nil)).Info("x", "session", s)
	js, _ := json.Marshal(map[string]any{"s": s})
	for _, out := range []string{fmt.Sprint(s), fmt.Sprintf("%+v %#v", s, s), logged.String(), string(js)} {
		if strings.Contains(out, mfltest.Session) {
			t.Fatalf("the session printed: %s", out)
		}
	}
}

// The member's leagues name their franchise in each, with the session.
func TestMyLeagues(t *testing.T) {
	srv := mfltest.New(t)
	got, err := srv.Client().MyLeagues(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season)
	if err != nil || len(got) != 2 || got[0].LeagueID != mfltest.LeagueID || got[0].Franchise != mfltest.Franchise ||
		got[0].Name != "Founder Test League" || got[0].TeamName != "Hunthrop" {
		t.Fatalf("%v %+v", err, got)
	}
	if c := srv.Cookies(); len(c) != 1 || c[0] != mfl.SessionCookie+"="+mfltest.Session {
		t.Fatalf("cookies %d", len(c))
	}
	srv.Set(func(s *mfltest.Server) { s.SessionRefused = true })
	if _, err := srv.Client().MyLeagues(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season); !errors.Is(err, mfl.ErrSignedOut) {
		t.Fatalf("a refused session answered %v", err)
	}
}

// The member's lineup is their franchise's roster, starters and the
// league's lineup rules for MyFantasyLeague's current week.
func TestMemberLineup(t *testing.T) {
	srv := mfltest.New(t)
	l, err := srv.Client().MemberLineup(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season, mfltest.LeagueID)
	if err != nil {
		t.Fatal(err)
	}
	if l.Franchise != mfltest.Franchise || l.Week != mfltest.Week || l.StarterCount != 4 || len(l.Limits) != 3 ||
		!slices.Equal(l.Starters, []string{mfltest.QB, mfltest.RBStarts, mfltest.WR1, mfltest.WR2}) ||
		!slices.Contains(l.Roster, mfltest.RBBench) || !slices.Equal(l.Reserve, []string{mfltest.OnIR}) {
		t.Fatalf("%+v", l)
	}
	if _, err := srv.Client().MemberLineup(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season, "30030"); !errors.Is(err, mfl.ErrNotYourTeam) {
		t.Fatalf("a league the member is not in answered %v", err)
	}
}

// A franchise live scoring does not list is never an empty lineup: the
// read fails, and a league with no head-to-head games, whose franchises
// are listed outside any matchup, reads as any other.
func TestMemberLineupNeedsTheFranchiseInLiveScoring(t *testing.T) {
	srv := mfltest.New(t)
	srv.Set(func(s *mfltest.Server) { s.Live = "live-member-absent.json" })
	sess := mfl.Session{UserID: mfltest.Session}
	if _, err := srv.Client().MemberLineup(context.Background(), sess, mfltest.Season, mfltest.LeagueID); !errors.Is(err, mfl.ErrNoLineup) {
		t.Fatalf("absent: %v", err)
	}
	srv.Set(func(s *mfltest.Server) { s.Live = "live-member-alone.json" })
	l, err := srv.Client().MemberLineup(context.Background(), sess, mfltest.Season, mfltest.LeagueID)
	if err != nil || !slices.Equal(l.Starters, []string{mfltest.QB, mfltest.RBStarts, mfltest.WR1, mfltest.WR2}) {
		t.Fatalf("listed outside a matchup: %v %+v", err, l.Starters)
	}
}

func lineup(t *testing.T, c *mfl.Client) mfl.TeamLineup {
	t.Helper()
	l, err := c.MemberLineup(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season, mfltest.LeagueID)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

var swapped = []string{mfltest.QB, mfltest.RBBench, mfltest.WR1, mfltest.WR2}

// The guard: only the member's own franchise, only players on its active
// roster, each once, no more than the league starts.
func TestOwnLineup(t *testing.T) {
	l := lineup(t, mfltest.New(t).Client())
	if _, err := mfl.OwnLineup(l, mfltest.Franchise, swapped); err != nil {
		t.Fatal(err)
	}
	cases := map[string]struct {
		franchise int
		starters  []string
		want      error
	}{
		"another franchise": {1, swapped, mfl.ErrNotYourTeam},
		"not on the roster": {mfltest.Franchise, []string{mfltest.QB, "14802", mfltest.WR1, mfltest.WR2}, mfl.ErrNotYourTeam},
		"on IR":             {mfltest.Franchise, []string{mfltest.QB, mfltest.OnIR, mfltest.WR1, mfltest.WR2}, mfl.ErrBadMove},
		"twice":             {mfltest.Franchise, []string{mfltest.QB, mfltest.QB, mfltest.WR1, mfltest.WR2}, mfl.ErrBadMove},
		"too many":          {mfltest.Franchise, append(slices.Clone(swapped), mfltest.WRBench), mfl.ErrBadMove},
		"fewer than starts": {mfltest.Franchise, swapped[:3], mfl.ErrBadMove},
		"one alone":         {mfltest.Franchise, []string{mfltest.RBBench}, mfl.ErrBadMove},
		"none":              {mfltest.Franchise, nil, mfl.ErrBadMove},
	}
	for name, c := range cases {
		if _, err := mfl.OwnLineup(l, c.franchise, c.starters); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
}

// The write: one POST to the import with TYPE=lineup, the franchise, the
// week and the starters in the body, the session in the Cookie header
// only; a success reads back as applied.
func TestSetLineup(t *testing.T) {
	srv := mfltest.New(t)
	c := srv.Client()
	set, err := mfl.OwnLineup(lineup(t, c), mfltest.Franchise, swapped)
	if err != nil {
		t.Fatal(err)
	}
	sess := mfl.Session{UserID: mfltest.Session}
	ans, err := c.SetLineup(context.Background(), sess, set)
	if err != nil || ans.Outcome != mfl.WriteDone || ans.Status != http.StatusOK {
		t.Fatalf("%v %+v", err, ans)
	}
	imports := srv.Imports()
	if len(imports) != 1 {
		t.Fatalf("%d imports", len(imports))
	}
	f := imports[0]
	if f.Get("TYPE") != "lineup" || f.Get("L") != mfltest.LeagueID || f.Get("W") != "7" || f.Has("FRANCHISE_ID") ||
		f.Get("STARTERS") != strings.Join(swapped, ",") {
		t.Fatalf("form %v", f)
	}
	for _, q := range srv.ImportQueries() {
		if q != "" {
			t.Fatalf("the import carried a query: %q", q)
		}
	}
	if strings.Contains(string(ans.Sent), mfltest.Session) || !strings.Contains(string(ans.Sent), `"STARTERS"`) {
		t.Fatalf("the kept body: %s", ans.Sent)
	}
	if ok, err := c.Applied(context.Background(), sess, set); err != nil || !ok {
		t.Fatalf("read back %v %v", ok, err)
	}
}

// A refusal is MyFantasyLeague's words, the session cut from them; an
// answer that is neither is unknown, and a session missing sends nothing.
func TestSetLineupAnswers(t *testing.T) {
	cases := []struct {
		name, answer string
		status       int
		want         mfl.WriteOutcome
		words        string
	}{
		{"locked", "import-locked.xml", http.StatusOK, mfl.WriteRefused, "Lineup is locked: a player's game has started."},
		{"invalid", "import-invalid.xml", http.StatusOK, mfl.WriteRefused, "An error has occurred - probably caused by one or more invalid parameters."},
		{"a 400 with no words", "", http.StatusBadRequest, mfl.WriteRefused, ""},
		{"a 500", "", http.StatusInternalServerError, mfl.WriteUnknown, ""},
		{"a 200 with no status", "", http.StatusOK, mfl.WriteUnknown, ""},
	}
	for _, tc := range cases {
		srv := mfltest.New(t)
		c := srv.Client()
		set, err := mfl.OwnLineup(lineup(t, c), mfltest.Franchise, swapped)
		if err != nil {
			t.Fatal(err)
		}
		srv.Set(func(s *mfltest.Server) { s.ImportAnswer, s.ImportStatus, s.Applies = tc.answer, tc.status, false })
		ans, err := c.SetLineup(context.Background(), mfl.Session{UserID: mfltest.Session}, set)
		if err != nil || ans.Outcome != tc.want || ans.Words != tc.words {
			t.Errorf("%s: %v %+v", tc.name, err, ans)
		}
	}
	srv := mfltest.New(t)
	c := srv.Client()
	set, _ := mfl.OwnLineup(lineup(t, c), mfltest.Franchise, swapped)
	if _, err := c.SetLineup(context.Background(), mfl.Session{}, set); !errors.Is(err, mfl.ErrNotSent) || len(srv.Imports()) != 0 {
		t.Fatalf("no session: %v, %d imports", err, len(srv.Imports()))
	}
}

// A read's refusal that echoes the session never carries it into an
// error, which callers log.
func TestReadRefusalRedacted(t *testing.T) {
	srv := mfltest.New(t)
	srv.Set(func(s *mfltest.Server) {
		s.SessionRefused, s.RefusalWords = true, "cookie "+mfltest.Session+" is not logged in"
	})
	_, err := srv.Client().MyLeagues(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season)
	if !errors.Is(err, mfl.ErrSignedOut) || strings.Contains(err.Error(), mfltest.Session) {
		t.Fatalf("%v", err)
	}
	srv.Set(func(s *mfltest.Server) { s.RefusalWords = "strange " + mfltest.Session })
	_, err = srv.Client().MyLeagues(context.Background(), mfl.Session{UserID: mfltest.Session}, mfltest.Season)
	if err == nil || strings.Contains(err.Error(), mfltest.Session) {
		t.Fatalf("%v", err)
	}
}

// MyFantasyLeague's words that echo the session never carry it out.
func TestRefusalWordsRedacted(t *testing.T) {
	got := mfl.RefusalWords([]byte(`<error>bad cookie `+mfltest.Session+` for you</error>`), mfl.Session{UserID: mfltest.Session})
	if strings.Contains(got, mfltest.Session) || !strings.Contains(got, "[redacted]") {
		t.Fatalf("%q", got)
	}
	long := mfl.RefusalWords([]byte(`{"error":{"$t":"`+strings.Repeat("a", 400)+`"}}`), mfl.Session{})
	if len([]rune(long)) != 300 {
		t.Fatalf("%d runes kept", len([]rune(long)))
	}
}
