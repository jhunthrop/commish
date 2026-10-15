package espn

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// The claim the tests send: Keenan Allen, on waivers in the derived
// player read, for Danny Amendola off team 1's bench.
const (
	claimAdd  = "15818"
	claimDrop = "11674"
)

// claimHost is ESPN's hosts for a claim: the league read (patched per
// test), the players read, the pending queue, and the write.
type claimHost struct {
	mu      sync.Mutex
	league  []byte
	players []byte
	pending []byte
	status  int
	answer  []byte
	// rosterAfter, when set, is the league read once a write is taken.
	rosterAfter []byte
	written     bool
	bodies      [][]byte
	filters     []string
	cookies     []string
	views       []string
}

func newClaimHost(t *testing.T, status int, answer string, patch func(map[string]any)) (*Client, *claimHost) {
	t.Helper()
	h := &claimHost{status: status, league: patchLeague(t, readFixture(t, writeLeague), patch),
		players: readFixture(t, "testdata/player-status-2026.json"), pending: readFixture(t, "testdata/pending-claims-2026.json")}
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
			h.bodies = append(h.bodies, body)
			h.cookies = append(h.cookies, r.Header.Get("Cookie"))
			h.written = true
			w.WriteHeader(h.status)
			_, _ = w.Write(h.answer)
		case r.Method == http.MethodGet && r.URL.Path == league:
			view := strings.Join(r.URL.Query()["view"], ",")
			h.views = append(h.views, view)
			switch view {
			case "kona_player_info":
				h.filters = append(h.filters, r.Header.Get("X-Fantasy-Filter"))
				_, _ = w.Write(h.players)
			case "mPendingTransactions":
				_, _ = w.Write(h.pending)
			default:
				if h.written && h.rosterAfter != nil {
					_, _ = w.Write(h.rosterAfter)
					return
				}
				_, _ = w.Write(h.league)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), Base: srv.URL, WriteBase: srv.URL}, h
}

// patchLeague applies patch to the league read's JSON.
func patchLeague(t *testing.T, raw []byte, patch func(map[string]any)) []byte {
	t.Helper()
	if patch == nil {
		return raw
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	patch(doc)
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// acquisition is the league's acquisitionSettings in a patch.
func acquisition(doc map[string]any) map[string]any {
	return doc["settings"].(map[string]any)["acquisitionSettings"].(map[string]any)
}

// teamOne is team 1 in a patch.
func teamOne(doc map[string]any) map[string]any {
	return doc["teams"].([]any)[0].(map[string]any)
}

func noBudget(doc map[string]any) { acquisition(doc)["isUsingAcquisitionBudget"] = false }

func readClaimLeague(t *testing.T, c *Client) FullLeague {
	t.Helper()
	l, err := c.Read(context.Background(), writeLeagueID, writeSeason, &writeCookies)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func bid(n int) *int { return &n }

// The league read carries the waiver settings, each team's budget spent
// and each player's droppable and roster lock.
func TestReadCarriesTheWaiverSettings(t *testing.T) {
	c, _ := newClaimHost(t, http.StatusOK, "", func(doc map[string]any) {
		teamOne(doc)["transactionCounter"] = map[string]any{"acquisitionBudgetSpent": 37}
	})
	l := readClaimLeague(t, c)
	a := l.Acquisition
	if !a.Budget || a.Total != 500 || a.MinimumBid != 0 || a.Type != "WAIVERS_TRADITIONAL" || len(a.ProcessDays) != 6 || a.ProcessDays[0] != "MONDAY" {
		t.Fatalf("acquisition %+v", a)
	}
	if l.Teams[0].BudgetSpent == nil || *l.Teams[0].BudgetSpent != 37 || l.Teams[1].BudgetSpent != nil {
		t.Fatalf("spent %v %v", l.Teams[0].BudgetSpent, l.Teams[1].BudgetSpent)
	}
	for _, p := range l.Teams[1].Roster {
		if p.Name == "DeAndre Hopkins" && p.Droppable() {
			t.Fatal("Hopkins reads droppable; ESPN says he is not")
		}
		if p.Name == "Josh Jacobs" && (!p.Droppable() || !p.RosterLocked) {
			t.Fatalf("Jacobs %+v", p)
		}
	}
}

// The players read asks ESPN for the one player by id and reads where he
// is: on waivers, a free agent, or on a team.
func TestAvailabilityReadsThePlayer(t *testing.T) {
	c, h := newClaimHost(t, http.StatusOK, "", nil)
	got, err := c.Availability(context.Background(), writeCookies, writeLeagueID, writeSeason, writeLeagueScoring, claimAdd)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusWaivers || got.OnTeam != 0 || got.Name != "Keenan Allen" {
		t.Fatalf("availability %+v", got)
	}
	if len(h.filters) != 1 || !strings.Contains(h.filters[0], `"filterIds":{"value":[15818]}`) {
		t.Fatalf("filter %q", h.filters)
	}
	if _, err := c.Availability(context.Background(), writeCookies, writeLeagueID, writeSeason, writeLeagueScoring, "not-an-id"); !errors.Is(err, ErrBadMove) {
		t.Fatalf("a bad id read: %v", err)
	}
	h.players = []byte(`{"players":[]}`)
	if _, err := c.Availability(context.Background(), writeCookies, writeLeagueID, writeSeason, writeLeagueScoring, claimAdd); !errors.Is(err, ErrMalformed) {
		t.Fatalf("a missing player: %v", err)
	}
}

// writeLeagueScoring is the derived league's scoring period.
const writeLeagueScoring = 7

// A claim is made only on the member's own team, for a player no team
// holds, with a drop of his own that ESPN lets go, and a bid only where
// the league bids, inside its bounds.
func TestOwnClaimGuards(t *testing.T) {
	waivers := Availability{Status: StatusWaivers, Name: "Keenan Allen"}
	cases := []struct {
		name  string
		patch func(map[string]any)
		swid  string
		team  int
		claim ClaimInput
		avail Availability
		want  error
	}{
		{"another team", nil, writeCookies.SWID, 2, ClaimInput{Add: claimAdd}, waivers, ErrNotYourTeam},
		{"another SWID", nil, "{0000000D-0000-4000-8000-00000000000D}", 1, ClaimInput{Add: claimAdd}, waivers, ErrNotYourTeam},
		{"a drop not his", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Drop: "15795"}, waivers, ErrDropGone},
		{"on a team", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd}, Availability{Status: StatusOnTeam, OnTeam: 3}, ErrNotAvailable},
		{"already his", nil, writeCookies.SWID, 1, ClaimInput{Add: claimDrop}, Availability{Status: StatusOnTeam, OnTeam: 1}, ErrNotAvailable},
		{"undroppable", func(doc map[string]any) {
			entry := teamOne(doc)["roster"].(map[string]any)["entries"].([]any)[10].(map[string]any)
			entry["playerPoolEntry"].(map[string]any)["player"].(map[string]any)["droppable"] = false
		}, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Drop: claimDrop}, waivers, ErrNotDroppable},
		{"a bid without a budget", noBudget, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Bid: bid(0)}, waivers, ErrBid},
		{"a bid over the budget", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Bid: bid(501)}, waivers, ErrBid},
		{"a bid over what is left", func(doc map[string]any) {
			teamOne(doc)["transactionCounter"] = map[string]any{"acquisitionBudgetSpent": 490}
		}, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Bid: bid(11)}, waivers, ErrBid},
		{"a bid under the minimum", func(doc map[string]any) { acquisition(doc)["minimumBid"] = 1 },
			writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Bid: bid(0)}, waivers, ErrBid},
		{"a negative bid", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Bid: bid(-1)}, waivers, ErrBid},
		{"no bid where the league bids", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd}, waivers, ErrBid},
		{"a free agent's drop locked", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Drop: "16733", Bid: bid(0)},
			Availability{Status: StatusFreeAgent}, ErrBadMove},
		{"add and drop the same", nil, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Drop: claimAdd, Bid: bid(0)}, waivers, ErrBadMove},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := newClaimHost(t, http.StatusOK, "", tc.patch)
			l := readClaimLeague(t, c)
			if _, err := OwnClaim(l, tc.swid, tc.team, tc.claim, tc.avail); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

// A waiver claim goes as WAIVER with the bid where the league bids, a
// free agent as FREEAGENT; no bid where the league does not, and never a
// memberId.
func TestClaimBody(t *testing.T) {
	c, _ := newClaimHost(t, http.StatusOK, "", nil)
	l := readClaimLeague(t, c)
	set, err := OwnClaim(l, writeCookies.SWID, 1, ClaimInput{Add: claimAdd, Drop: claimDrop, Bid: bid(12)}, Availability{Status: StatusWaivers})
	if err != nil {
		t.Fatal(err)
	}
	body, err := set.Body()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"isLeagueManager":false,"teamId":1,"type":"WAIVER","scoringPeriodId":7,"executionType":"EXECUTE",` +
		`"items":[{"playerId":15818,"type":"ADD","toTeamId":1},{"playerId":11674,"type":"DROP","fromTeamId":1}],"bidAmount":12}`
	if string(body) != want {
		t.Fatalf("body\n%s\nwant\n%s", body, want)
	}
	if !set.Waiver() || set.Bid() == nil || *set.Bid() != 12 {
		t.Fatalf("set %+v", set)
	}

	c, _ = newClaimHost(t, http.StatusOK, "", noBudget)
	l = readClaimLeague(t, c)
	set, err = OwnClaim(l, writeCookies.SWID, 1, ClaimInput{Add: claimAdd}, Availability{Status: StatusFreeAgent})
	if err != nil {
		t.Fatal(err)
	}
	body, _ = set.Body()
	want = `{"isLeagueManager":false,"teamId":1,"type":"FREEAGENT","scoringPeriodId":7,"executionType":"EXECUTE",` +
		`"items":[{"playerId":15818,"type":"ADD","toTeamId":1}]}`
	if string(body) != want || set.Waiver() {
		t.Fatalf("body %s", body)
	}
}

func ownClaim(t *testing.T, c *Client, claim ClaimInput, avail Availability) ClaimSet {
	t.Helper()
	set, err := OwnClaim(readClaimLeague(t, c), writeCookies.SWID, 1, claim, avail)
	if err != nil {
		t.Fatal(err)
	}
	return set
}

// A waiver claim ESPN takes is pending, with its id; the queue read
// finds it by that id and says when ESPN runs it. Sent once, with the
// cookies and ESPN's headers.
func TestClaimPendingAndTheQueue(t *testing.T) {
	c, h := newClaimHost(t, http.StatusOK, "write-claim-pending.json", nil)
	set := ownClaim(t, c, ClaimInput{Add: claimAdd, Drop: claimDrop, Bid: bid(0)}, Availability{Status: StatusWaivers})
	ans, err := c.Claim(context.Background(), writeCookies, set)
	if err != nil {
		t.Fatal(err)
	}
	if ans.Outcome != WritePending || ans.Status != http.StatusOK || ans.TransactionID != "7c1a2f60-0000-4000-8000-000000000004" {
		t.Fatalf("answer %+v", ans)
	}
	if len(h.bodies) != 1 || !strings.Contains(h.cookies[0], "espn_s2=") || bytes.Contains(ans.Sent, []byte(writeCookies.SWID)) {
		t.Fatalf("sent %d %q", len(h.bodies), ans.Sent)
	}
	q, err := c.PendingClaim(context.Background(), writeCookies, set, ans.TransactionID)
	if err != nil {
		t.Fatal(err)
	}
	if !q.Found || q.ProcessAt == nil || !q.ProcessAt.Equal(time.UnixMilli(1792134000000)) {
		t.Fatalf("queue %+v", q)
	}
	q, err = c.PendingClaim(context.Background(), writeCookies, set, "another-id")
	if err != nil || q.Found {
		t.Fatalf("another id %+v %v", q, err)
	}
	// An answer lost: the claim is found by the team and its players.
	if q, err := c.PendingClaim(context.Background(), writeCookies, set, ""); err != nil || !q.Found || q.ProcessAt == nil {
		t.Fatalf("by its players %+v %v", q, err)
	}
	other := ownClaim(t, c, ClaimInput{Add: claimAdd, Drop: "3050487", Bid: bid(0)}, Availability{Status: StatusWaivers})
	if q, err := c.PendingClaim(context.Background(), writeCookies, other, ""); err != nil || q.Found {
		t.Fatalf("another drop %+v %v", q, err)
	}
	h.pending = []byte(`{"id":48153503}`)
	if _, err := c.PendingClaim(context.Background(), writeCookies, set, ans.TransactionID); !errors.Is(err, ErrMalformed) {
		t.Fatalf("a queue without its key is drift, never an empty queue: %v", err)
	}
}

// ESPN's refusals of a claim are refusals in its words.
func TestClaimRefusals(t *testing.T) {
	for _, tc := range []struct{ answer, reason, words string }{
		{"write-claim-not-freeagent.json", "TRAN_PLAYER_NOT_FREEAGENT", "Player 15818 is not a free agent"},
		{"write-claim-budget-not-supported.json", "TRAN_ACQUISITION_BUDGET_NOT_SUPPORTED", "This League does not support bids on Transactions."},
	} {
		c, h := newClaimHost(t, http.StatusConflict, tc.answer, nil)
		set := ownClaim(t, c, ClaimInput{Add: claimAdd, Bid: bid(0)}, Availability{Status: StatusWaivers})
		ans, err := c.Claim(context.Background(), writeCookies, set)
		if err != nil || ans.Outcome != WriteRefused || ans.Refusal.Type != tc.reason || ans.Refusal.Message != tc.words || len(h.bodies) != 1 {
			t.Fatalf("%s: %+v %v", tc.answer, ans, err)
		}
	}
}

// A free agent's add ESPN executes at once is read back on the roster:
// him on the team and the drop gone.
func TestClaimedReadsTheRosterBack(t *testing.T) {
	// The derived league holds every player locked on the roster, as the
	// 2019 read it comes from did at the season's end: Amendola is free here.
	c, h := newClaimHost(t, http.StatusOK, "write-lineup-executed.json", func(doc map[string]any) {
		noBudget(doc)
		entry := teamOne(doc)["roster"].(map[string]any)["entries"].([]any)[10].(map[string]any)
		entry["playerPoolEntry"].(map[string]any)["rosterLocked"] = false
	})
	set := ownClaim(t, c, ClaimInput{Add: claimAdd, Drop: claimDrop}, Availability{Status: StatusFreeAgent})
	if got, err := c.Claimed(context.Background(), writeCookies, set); err != nil || got {
		t.Fatalf("before the add: %v %v", got, err)
	}
	h.rosterAfter = patchLeague(t, h.league, func(doc map[string]any) {
		roster := teamOne(doc)["roster"].(map[string]any)
		entries := roster["entries"].([]any)
		for i, e := range entries {
			if e.(map[string]any)["playerId"].(float64) == 11674 {
				entry := e.(map[string]any)
				entry["playerId"] = 15818
				entry["playerPoolEntry"].(map[string]any)["player"].(map[string]any)["id"] = 15818
				entries[i] = entry
			}
		}
	})
	ans, err := c.Claim(context.Background(), writeCookies, set)
	if err != nil || ans.Outcome != WriteExecuted {
		t.Fatalf("answer %+v %v", ans, err)
	}
	if got, err := c.Claimed(context.Background(), writeCookies, set); err != nil || !got {
		t.Fatalf("after the add: %v %v", got, err)
	}
}

// No cookies, nothing sent.
func TestClaimNotSentWithoutCookies(t *testing.T) {
	c, h := newClaimHost(t, http.StatusOK, "write-claim-pending.json", nil)
	set := ownClaim(t, c, ClaimInput{Add: claimAdd, Bid: bid(0)}, Availability{Status: StatusWaivers})
	if _, err := c.Claim(context.Background(), Cookies{}, set); !errors.Is(err, ErrNotSent) || len(h.bodies) != 0 {
		t.Fatalf("%v %d", err, len(h.bodies))
	}
}

// A club's D/ST id is ESPN's own: every defense in the recorded league
// (fourteen teams' rosters) carries -(16000 + its proTeamId).
func TestDefenseIDMatchesTheRecordedLeague(t *testing.T) {
	var doc struct {
		Teams []struct {
			Roster struct {
				Entries []struct {
					PlayerID        int `json:"playerId"`
					PlayerPoolEntry struct {
						Player struct {
							DefaultPositionID int `json:"defaultPositionId"`
							ProTeamID         int `json:"proTeamId"`
						} `json:"player"`
					} `json:"playerPoolEntry"`
				} `json:"entries"`
			} `json:"roster"`
		} `json:"teams"`
	}
	if err := json.Unmarshal(readFixture(t, "testdata/league-48153503-2019-full.json"), &doc); err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, team := range doc.Teams {
		for _, e := range team.Roster.Entries {
			p := e.PlayerPoolEntry.Player
			if p.DefaultPositionID != 16 {
				continue
			}
			seen++
			if got, ok := DefenseID(proTeams[p.ProTeamID]); !ok || got != strconv.Itoa(e.PlayerID) {
				t.Errorf("proTeam %d: %q, ESPN says %d", p.ProTeamID, got, e.PlayerID)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no defense in the recorded league")
	}
	if _, ok := DefenseID("XYZ"); ok {
		t.Fatal("a club ESPN does not name has a D/ST id")
	}
}

// The days a league runs claims, in words and the week's order.
func TestProcessDays(t *testing.T) {
	for _, tc := range []struct {
		days []string
		want string
	}{
		{nil, ""},
		{[]string{"WEDNESDAY"}, "Wednesday"},
		{[]string{"FRIDAY", "TUESDAY"}, "Tuesday and Friday"},
		{[]string{"MONDAY", "FRIDAY", "THURSDAY", "SUNDAY", "SATURDAY", "WEDNESDAY"}, "Monday, Wednesday, Thursday, Friday, Saturday and Sunday"},
		{[]string{"someday"}, ""},
	} {
		if got := ProcessDays(Acquisition{ProcessDays: tc.days}); got != tc.want {
			t.Errorf("%v: %q, want %q", tc.days, got, tc.want)
		}
	}
}
