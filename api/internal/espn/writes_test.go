package espn

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

// The write fixtures: a league derived for these tests (league-write-2026,
// before and after the swap) and ESPN's answers as third parties captured
// them live (write-*.json, each naming its source in _source).
const (
	writeLeague      = "testdata/league-write-2026.json"
	writeLeagueAfter = "testdata/league-write-2026-after.json"
	writeLeagueID    = "48153503"
	writeSeason      = 2026
	// The member owns team 1 in the write fixture.
	writeTeam = 1
)

var writeCookies = Cookies{SWID: "{00000011-0000-4000-8000-000000000011}", S2: strings.Repeat("AEB", 30) + "%2B%3D"}

// The swap the tests send: Mattison off the bench into RB, Washington to
// the bench.
var rbSwap = []LineupItem{{PlayerID: "4048244", From: 20, To: 2}, {PlayerID: "2577654", From: 2, To: 20}}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// writeHost is ESPN's read and write hosts in one test server: reads
// answer before, until a write is taken, then after; a write answers
// status and body. It keeps every write's body and headers.
type writeHost struct {
	mu      sync.Mutex
	status  int
	answer  []byte
	applied bool
	before  []byte
	after   []byte
	writes  []*http.Request
	bodies  [][]byte
}

func newWriteHost(t *testing.T, status int, answer string) (*Client, *writeHost) {
	t.Helper()
	h := &writeHost{status: status, before: readFixture(t, writeLeague), after: readFixture(t, writeLeagueAfter)}
	if answer != "" {
		h.answer = readFixture(t, "testdata/"+answer)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		league := "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/" + writeLeagueID
		switch {
		case r.Method == http.MethodPost && r.URL.Path == league+"/transactions/":
			body, _ := io.ReadAll(r.Body)
			h.writes = append(h.writes, r)
			h.bodies = append(h.bodies, body)
			if h.status == http.StatusOK {
				h.applied = true
			}
			w.WriteHeader(h.status)
			_, _ = w.Write(h.answer)
		case r.Method == http.MethodGet && r.URL.Path == league:
			if h.applied {
				_, _ = w.Write(h.after)
				return
			}
			_, _ = w.Write(h.before)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), Base: srv.URL, WriteBase: srv.URL}, h
}

func ownSet(t *testing.T, c *Client, items []LineupItem) LineupSet {
	t.Helper()
	l, err := c.Read(context.Background(), writeLeagueID, writeSeason, &writeCookies)
	if err != nil {
		t.Fatal(err)
	}
	set, err := OwnLineup(l, writeCookies.SWID, writeTeam, items)
	if err != nil {
		t.Fatal(err)
	}
	return set
}

// A read carries each player's eligible slots and ESPN's lock.
func TestReadCarriesEligibilityAndLock(t *testing.T) {
	c, _ := newWriteHost(t, http.StatusOK, "")
	l, err := c.Read(context.Background(), writeLeagueID, writeSeason, &writeCookies)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range l.Teams[0].Roster {
		switch p.Name {
		case "Odell Beckham Jr.":
			if !p.Locked {
				t.Fatal("Beckham reads unlocked")
			}
		case "Alexander Mattison":
			if p.Locked || len(p.Eligible) == 0 || p.Eligible[0] != 2 {
				t.Fatalf("Mattison: %+v", p)
			}
		}
	}
}

// The guard: a lineup is set on the member's own team only, the team the
// caller names and the SWID owns, never another manager's, before any
// request is made.
func TestOwnLineupRefusesAnotherTeam(t *testing.T) {
	c, h := newWriteHost(t, http.StatusOK, "write-lineup-executed.json")
	l, err := c.Read(context.Background(), writeLeagueID, writeSeason, &writeCookies)
	if err != nil {
		t.Fatal(err)
	}
	other := []LineupItem{{PlayerID: "17359", From: 20, To: 2}, {PlayerID: "4047365", From: 2, To: 20}}
	cases := map[string]func() error{
		"another team named": func() error { _, err := OwnLineup(l, writeCookies.SWID, 2, other); return err },
		"own team, another SWID": func() error {
			_, err := OwnLineup(l, "{00000099-0000-4000-8000-000000000099}", writeTeam, rbSwap)
			return err
		},
		"a team not in the league": func() error { _, err := OwnLineup(l, writeCookies.SWID, 9, rbSwap); return err },
		"a player not on the team": func() error { _, err := OwnLineup(l, writeCookies.SWID, writeTeam, other); return err },
	}
	for name, try := range cases {
		if err := try(); !errors.Is(err, ErrNotYourTeam) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if len(h.writes) != 0 {
		t.Fatalf("%d writes sent", len(h.writes))
	}
}

// A move is refused before sending when it holds a locked player, an item
// that does not move, a slot the player does not start from, or a slot he
// cannot fill.
func TestOwnLineupChecksTheItems(t *testing.T) {
	c, _ := newWriteHost(t, http.StatusOK, "")
	l, err := c.Read(context.Background(), writeLeagueID, writeSeason, &writeCookies)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]LineupItem{
		"none":           nil,
		"same slot":      {{PlayerID: "4048244", From: 20, To: 20}},
		"wrong from":     {{PlayerID: "4048244", From: 2, To: 20}},
		"ineligible":     {{PlayerID: "4048244", From: 20, To: 0}},
		"locked":         {{PlayerID: "16733", From: 23, To: 20}},
		"twice":          {{PlayerID: "4048244", From: 20, To: 2}, {PlayerID: "4048244", From: 20, To: 23}},
		"not a slot":     {{PlayerID: "4048244", From: 20, To: 99}},
		"unknown player": {{PlayerID: "1", From: 20, To: 2}},
	}
	for name, items := range cases {
		if _, err := OwnLineup(l, writeCookies.SWID, writeTeam, items); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// ESPN executes the swap: one POST to the write host with the two cookies
// and the captured body (no memberId), then a read-back finds every
// player where the move put him.
func TestSetLineupExecutedAndReadBack(t *testing.T) {
	c, h := newWriteHost(t, http.StatusOK, "write-lineup-executed.json")
	set := ownSet(t, c, rbSwap)
	got, err := c.SetLineup(context.Background(), writeCookies, set)
	if err != nil {
		t.Fatal(err)
	}
	if got.Outcome != WriteExecuted || got.Status != http.StatusOK || got.TransactionID == "" {
		t.Fatalf("answer %+v", got)
	}
	if len(h.writes) != 1 {
		t.Fatalf("%d writes", len(h.writes))
	}
	r := h.writes[0]
	if r.Header.Get("Cookie") != writeCookies.header() || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("X-Fantasy-Source") != "kona" {
		t.Fatalf("headers %v", r.Header)
	}
	var body map[string]any
	if err := json.Unmarshal(h.bodies[0], &body); err != nil {
		t.Fatal(err)
	}
	if body["type"] != "ROSTER" || body["executionType"] != "EXECUTE" || body["teamId"] != float64(1) || body["scoringPeriodId"] != float64(7) ||
		body["isLeagueManager"] != false {
		t.Fatalf("body %s", h.bodies[0])
	}
	if _, ok := body["memberId"]; ok {
		t.Fatal("the body carries the SWID")
	}
	items := body["items"].([]any)
	first := items[0].(map[string]any)
	if len(items) != 2 || first["playerId"] != float64(4048244) || first["type"] != "LINEUP" || first["fromLineupSlotId"] != float64(20) || first["toLineupSlotId"] != float64(2) {
		t.Fatalf("items %v", items)
	}
	if strings.Contains(string(got.Sent), writeCookies.S2) || strings.Contains(string(got.Sent), writeCookies.SWID) {
		t.Fatal("the sent body holds a cookie")
	}
	ok, err := c.Applied(context.Background(), writeCookies, set)
	if err != nil || !ok {
		t.Fatalf("read-back: %v %v", ok, err)
	}
}

// A read-back that does not find the move says so: the move is not
// confirmed.
func TestReadBackNotMatching(t *testing.T) {
	c, _ := newWriteHost(t, http.StatusOK, "")
	set := ownSet(t, c, rbSwap)
	ok, err := c.Applied(context.Background(), writeCookies, set)
	if err != nil || ok {
		t.Fatalf("an unapplied read-back: %v %v", ok, err)
	}
}

// ESPN's refusals come back in ESPN's own words with their type.
func TestSetLineupRefusals(t *testing.T) {
	cases := []struct {
		status        int
		fixture, typ  string
		messagePrefix string
	}{
		{http.StatusConflict, "write-lineup-locked.json", "TRAN_LINEUP_LOCKED", "Lineup transaction could not be completed, Alexander Mattison is locked"},
		{http.StatusConflict, "write-lineup-not-current.json", "TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT", "Transaction type can only be executed"},
		{http.StatusUnauthorized, "write-unauthorized.json", "AUTH_MISSING_CREDENTIALS", "Unauthorized:  Credentials are missing."},
	}
	for _, tc := range cases {
		c, h := newWriteHost(t, tc.status, tc.fixture)
		got, err := c.SetLineup(context.Background(), writeCookies, ownSet(t, c, rbSwap))
		if err != nil {
			t.Fatal(err)
		}
		if got.Outcome != WriteRefused || got.Refusal.Type != tc.typ || !strings.HasPrefix(got.Refusal.Message, tc.messagePrefix) || got.Status != tc.status {
			t.Fatalf("%s: %+v", tc.fixture, got)
		}
		if len(h.writes) != 1 {
			t.Fatalf("%s: %d writes, never a retry", tc.fixture, len(h.writes))
		}
	}
}

// A 400 with no details is refused too (nothing applied); a server error
// or an answer that does not parse is not known, and is never retried.
func TestSetLineupUnknownAndMalformed(t *testing.T) {
	cases := []struct {
		status int
		body   string
		want   WriteOutcome
	}{
		{http.StatusBadRequest, `{"messages":["Bad request"]}`, WriteRefused},
		{http.StatusInternalServerError, `oops`, WriteUnknown},
		{http.StatusOK, `not json`, WriteUnknown},
		{http.StatusOK, `{"status":"PENDING"}`, WriteUnknown},
	}
	for _, tc := range cases {
		h := &writeHost{}
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				h.mu.Lock()
				h.writes = append(h.writes, r)
				h.mu.Unlock()
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
				return
			}
			_, _ = w.Write(readFixture(t, writeLeague))
		}))
		c := &Client{HTTP: srv.Client(), Base: srv.URL, WriteBase: srv.URL}
		got, err := c.SetLineup(context.Background(), writeCookies, ownSet(t, c, rbSwap))
		srv.Close()
		if err != nil || got.Outcome != tc.want || len(h.writes) != 1 {
			t.Fatalf("%d %q: %+v %v (%d writes)", tc.status, tc.body, got, err, len(h.writes))
		}
	}
}

// A write that never reaches ESPN is not sent; one whose answer is lost is
// not known.
func TestSetLineupUnreachable(t *testing.T) {
	c, _ := newWriteHost(t, http.StatusOK, "")
	set := ownSet(t, c, rbSwap)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hj, _ := w.(http.Hijacker)
		conn, _, _ := hj.Hijack()
		_ = conn.Close()
	}))
	defer srv.Close()
	lost := &Client{HTTP: srv.Client(), WriteBase: srv.URL}
	got, err := lost.SetLineup(context.Background(), writeCookies, set)
	if err != nil || got.Outcome != WriteUnknown {
		t.Fatalf("lost answer: %+v %v", got, err)
	}
	if _, err := c.SetLineup(context.Background(), Cookies{}, set); !errors.Is(err, ErrNotSent) {
		t.Fatalf("no cookies: %v", err)
	}
	busy := &Client{HTTP: srv.Client(), WriteBase: srv.URL, Pace: refusePace{}}
	if _, err := busy.SetLineup(context.Background(), writeCookies, set); !errors.Is(err, ErrNotSent) {
		t.Fatalf("no turn: %v", err)
	}
}

type refusePace struct{}

func (refusePace) Wait(context.Context) error { return errors.New("busy") }

// An error never prints a cookie.
func TestWriteErrorsNeverPrintACookie(t *testing.T) {
	c, _ := newWriteHost(t, http.StatusOK, "")
	set := ownSet(t, c, rbSwap)
	busy := &Client{HTTP: http.DefaultClient, WriteBase: "http://127.0.0.1:1", Pace: refusePace{}}
	_, err := busy.SetLineup(context.Background(), writeCookies, set)
	if err == nil || strings.Contains(err.Error(), writeCookies.S2) || strings.Contains(err.Error(), writeCookies.SWID) {
		t.Fatalf("error %v", err)
	}
}
