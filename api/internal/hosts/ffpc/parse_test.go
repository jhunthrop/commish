package ffpc

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

// The fixtures are the founder's own league (Big Gorilla #104870, team
// 11, season 2026, week 6) captured from their signed-in browser on
// 2026-10-13, plus FFPC's public Big Gorilla official rules. Each test
// asserts every field the page carries for its shape, and names the
// fields the page does not carry.

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestBanner(t *testing.T) {
	b, err := ParseBanner(fixture(t, "ffpc-league-home.html"))
	if err != nil {
		t.Fatal(err)
	}
	want := Banner{LeagueID: "104870", LeagueName: "Big Gorilla Tourney (Aug 21 9:00 PM) #104870", LeagueType: "Big Gorilla",
		Season: 2026, TeamID: 11, TeamName: "My Ball Zach Ertz"}
	if b != want {
		t.Fatalf("banner %+v\nwant   %+v", b, want)
	}
	if _, err := ParseBanner(fixture(t, "ffpc-owners.html")); !errors.Is(err, ErrNotThisPage) {
		t.Fatalf("a page with no banner: %v", err)
	}
}

func TestStandings(t *testing.T) {
	list, err := ParseStandings(fixture(t, "ffpc-standings.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 12 {
		t.Fatalf("%d teams", len(list))
	}
	top := list[0]
	if top.TeamID != 3 || top.Name != "5 - Diron Talbert" || top.Wins != 4 || top.Losses != 1 || top.Ties != 0 ||
		!top.HasRecord || top.PointsFor != 748.50 || top.PointsAgainst != 655.25 || !top.HasAgainst || top.Streak != "W4" {
		t.Fatalf("first %+v", top)
	}
	ids := map[int]bool{}
	for _, s := range list {
		ids[s.TeamID] = true
		if s.Name == "" || s.Wins+s.Losses+s.Ties != 5 {
			t.Fatalf("row %+v", s)
		}
	}
	if len(ids) != 12 || !ids[11] {
		t.Fatalf("team ids %v", ids)
	}
}

func TestOwners(t *testing.T) {
	list, err := ParseOwners(fixture(t, "ffpc-owners.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 12 {
		t.Fatalf("%d owners", len(list))
	}
	found := false
	for _, o := range list {
		if o.Team == "" || o.Owner == "" {
			t.Fatalf("owner row %+v", o)
		}
		if o.Team == "5 - Diron Talbert" && o.Owner == "srasp1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("owners %+v", list)
	}
}

func TestRosters(t *testing.T) {
	list, err := ParseRosters(fixture(t, "ffpc-rosters.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 12 {
		t.Fatalf("%d teams", len(list))
	}
	for _, r := range list {
		if r.TeamID < 1 || r.Name == "" || len(r.Players) != 20 {
			t.Fatalf("team %d %q with %d players", r.TeamID, r.Name, len(r.Players))
		}
		for _, p := range r.Players {
			if p.ID == "" || p.Name == "" || p.Position == "" {
				t.Fatalf("player %+v", p)
			}
		}
	}
	first := list[0]
	allen := first.Players[0]
	if first.TeamID != 1 || allen != (Player{ID: "27208", Name: "Josh Allen", Position: QB, Team: "BUF"}) {
		t.Fatalf("first team %d, first player %+v", first.TeamID, allen)
	}
	positions := map[string]int{}
	for _, r := range list {
		for _, p := range r.Players {
			positions[p.Position]++
			if p.Position == DEF && (p.Team == "" || p.Name != p.Team+" Defense") {
				t.Fatalf("defense %+v", p)
			}
		}
	}
	for _, pos := range []string{QB, RB, WR, TE, K, DEF} {
		if positions[pos] == 0 {
			t.Fatalf("no %s on any roster: %v", pos, positions)
		}
	}
}

func TestLineup(t *testing.T) {
	l, err := ParseLineup(fixture(t, "ffpc-team-lineup.html"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Week != 6 || l.Owner != "jh0486" || len(l.Starters) != 10 || len(l.Bench) != 10 {
		t.Fatalf("week %d owner %q, %d starters, %d bench", l.Week, l.Owner, len(l.Starters), len(l.Bench))
	}
	if l.Starters[0] != (Player{ID: "29012", Name: "Drake Maye", Position: QB, Team: "NE"}) || l.Slots[0] != "QB" {
		t.Fatalf("first starter %+v in %q", l.Starters[0], l.Slots[0])
	}
	if !slices.Equal(l.Slots, []string{"QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "PK", "DST"}) {
		t.Fatalf("slots %v", l.Slots)
	}
	dst := l.Starters[9]
	if dst.ID != "DPATS" || dst.Position != DEF || dst.Team != "NE" || dst.Name != "NE Defense" {
		t.Fatalf("defense %+v", dst)
	}
	if k := l.Starters[8]; k.Position != K || k.Name != "Cam Little" || k.Team != "JAC" {
		t.Fatalf("kicker %+v", k)
	}
}

func TestSchedule(t *testing.T) {
	weeks, err := ParseSchedule(fixture(t, "ffpc-schedule.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(weeks) < 12 {
		t.Fatalf("%d weeks", len(weeks))
	}
	w1 := weeks[0]
	if w1.Number != 1 || len(w1.Games) != 6 || w1.AllPlay {
		t.Fatalf("week 1 %+v", w1)
	}
	if g := w1.Games[0]; g != (Game{Away: 11, Home: 2, AwayPoints: 135.40, HomePoints: 203.95}) {
		t.Fatalf("first game %+v", g)
	}
	if w6 := weeks[5]; w6.Number != 6 || !w6.AllPlay || len(w6.Games) != 0 {
		t.Fatalf("week 6 %+v", w6)
	}
	at := time.Date(2026, 9, 10, 12, 0, 0, 0, eastern())
	if got := WeekOf(weeks, at); got != 1 {
		t.Fatalf("week of %v: %d", at, got)
	}
}

func TestMoves(t *testing.T) {
	moves, err := ParseMoves(fixture(t, "ffpc-league-home.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 4 {
		t.Fatalf("%d moves", len(moves))
	}
	m := moves[0]
	at := time.Date(2026, 10, 11, 10, 2, 42, 0, eastern())
	if !m.At.Equal(at) || m.TeamID != 8 || len(m.Adds) != 1 || len(m.Drops) != 1 {
		t.Fatalf("first move %+v", m)
	}
	if m.Adds[0] != (Player{Name: "Kimani Vidal", Position: RB, Team: "LAC"}) ||
		m.Drops[0] != (Player{Name: "Raheim Sanders", Position: RB, Team: "CLE"}) {
		t.Fatalf("players %+v %+v", m.Adds[0], m.Drops[0])
	}
}

func TestFreeAgents(t *testing.T) {
	pool, err := ParseFreeAgents(fixture(t, "ffpc-free-agents.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pool) != 30 {
		t.Fatalf("%d free agents", len(pool))
	}
	if pool[0] != (Player{ID: "27572", Name: "Drew Lock", Position: QB, Team: "SEA"}) {
		t.Fatalf("first %+v", pool[0])
	}
}

func TestMyTeams(t *testing.T) {
	list, err := ParseMyTeams(fixture(t, "ffpc-my-teams.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("%d leagues: %+v", len(list), list)
	}
	l := list[0]
	if l.LeagueID != "104870" || l.Name == "" || l.TeamName == "" || l.Record != "2 - 3" || l.Points != 598.70 || l.Place != 11 {
		t.Fatalf("first league %+v", l)
	}
}

func TestRulesAndScoring(t *testing.T) {
	r, err := ParseRules(fixture(t, "ffpc-rules.html"))
	if err != nil {
		t.Fatal(err)
	}
	want := LineupCounts{QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, Flex: 2}
	if r.Teams != 12 || r.RosterSpots != 20 || r.Rounds != 20 || !r.Snake || !r.HasLineup ||
		r.Lineup.Starters() != want.Starters() || r.Lineup.QB != 1 || r.Lineup.Flex != 2 || r.Lineup.DEF != 1 || len(r.Lineup.Other) != 0 {
		t.Fatalf("rules %+v", r)
	}
	if r.PlayoffStartWeek != 13 {
		t.Fatalf("the Duration row says League Playoffs Weeks 13-14, read %d", r.PlayoffStartWeek)
	}
	for value, want := range map[string]int{
		"Regular season Weeks 1-14. Playoffs Weeks 15-17": 15,
		"Regular season Weeks 1-13":                       14,
		"Weeks 1-17":                                      0,
	} {
		var other Rules
		ruleRow(&other, "duration:", value)
		if other.PlayoffStartWeek != want {
			t.Errorf("duration %q: playoffs from %d, want %d", value, other.PlayoffStartWeek, want)
		}
	}
	if r.PlayoffLastWeek != 14 {
		t.Fatalf("the Duration row says League Playoffs Weeks 13-14, read the last as %d", r.PlayoffLastWeek)
	}
	wantSeeds := []string{SeedRecord, SeedPoints, SeedRecord, SeedPoints}
	if !slices.Equal(r.Seeds, wantSeeds) {
		t.Fatalf("seeds %v, want %v", r.Seeds, wantSeeds)
	}
	if r.OfficialRules != "https://myffpc.com/cms/public/play/big-gorilla-official-rules" {
		t.Fatalf("official rules %q", r.OfficialRules)
	}
	if len(r.Scoring) != 0 {
		t.Fatalf("the league page states no scoring, read %v", r.Scoring)
	}
	scoring, unread, err := ParseScoring(fixture(t, "public-big-gorilla-official-rules.html"))
	if err != nil {
		t.Fatal(err)
	}
	wantScoring := map[string]float64{
		"pass_yd": 0.05, "pass_td": 4, "pass_int": -1, "fum_lost": -1, "pass_2pt": 2, "rush_2pt": 2, "rec_2pt": 2,
		"rush_yd": 0.1, "rush_td": 6, "rec_yd": 0.1, "rec_td": 6, "rec": 1, "bonus_rec_te": 0.5,
		"xpm": 1, "fgm": 3, "sack": 1, "blk_kick": 2, "int": 2, "fum_rec": 2, "def_td": 6, "safe": 5,
		"pts_allow_0": 12, "pts_allow_1_6": 8, "pts_allow_7_13": 5,
	}
	for k, v := range wantScoring {
		if scoring[k] != v {
			t.Errorf("%s = %v, want %v", k, scoring[k], v)
		}
	}
	for k := range scoring {
		if _, ok := wantScoring[k]; !ok {
			t.Errorf("unexpected key %s = %v", k, scoring[k])
		}
	}
	// Named, never lost: the distance bonus, the return after a failed
	// try, and the brackets that are not Sleeper's own.
	if len(unread) != 5 {
		t.Fatalf("unread %q", unread)
	}
}

func TestDraftBoard(t *testing.T) {
	d, err := ParseDraftBoard(fixture(t, "ffpc-draft-board.html"))
	if err != nil {
		t.Fatal(err)
	}
	if d.Teams != 12 || d.Rounds != 20 || len(d.Picks) != 240 || !d.Complete || d.MySlot != 10 {
		t.Fatalf("draft %d teams, %d rounds, %d picks, complete %v, my slot %d", d.Teams, d.Rounds, len(d.Picks), d.Complete, d.MySlot)
	}
	if d.SlotNames[9] != "My Ball Zach Ertz" || d.SlotNames[0] != "5 - Diron Talbert" {
		t.Fatalf("slots %q", d.SlotNames)
	}
	byNumber := map[int]Pick{}
	for _, p := range d.Picks {
		byNumber[p.Number] = p
	}
	if p := byNumber[1]; p.Round != 1 || p.Slot != 1 || p.Player != (Player{Name: "Jahmyr Gibbs", Position: RB, Team: "DET"}) {
		t.Fatalf("pick 1 %+v", p)
	}
	if p := byNumber[6]; !p.Auto || p.Player.Name != "Amon-Ra St. Brown" {
		t.Fatalf("pick 6 %+v", p)
	}
	if p := byNumber[8]; !p.Player.NameCut || p.Player.Name != "Jaxon Smith-Nji" {
		t.Fatalf("pick 8 %+v", p)
	}
	if p := byNumber[13]; p.Round != 2 || p.Slot != 12 || p.Player.Name != "De'Von Achane" {
		t.Fatalf("pick 13 %+v", p)
	}
	if p := byNumber[167]; p.Player.Position != DEF || p.Player.Team != "SEA" || p.Player.Name != "SEA Defense" {
		t.Fatalf("pick 167 %+v", p)
	}
	mine := 0
	for _, p := range d.Picks {
		if p.Mine {
			mine++
			if p.Slot != 10 {
				t.Fatalf("my pick %+v", p)
			}
		}
	}
	if mine != 20 {
		t.Fatalf("%d of my picks", mine)
	}
}

func TestUnavailablePages(t *testing.T) {
	if !IsDraftReportUnavailable(fixture(t, "ffpc-draft-report.html")) {
		t.Fatal("the draft report card reads as available")
	}
	if !IsUnavailable(fixture(t, "ffpc-scoreboard.html")) {
		t.Fatal("the live scoring page reads as available")
	}
	if IsUnavailable(fixture(t, "ffpc-standings.html")) {
		t.Fatal("the standings read as unavailable")
	}
}

func TestOversizedPageIsRefused(t *testing.T) {
	if _, err := ParseStandings(make([]byte, MaxPage+1)); err == nil {
		t.Fatal("an oversized page parsed")
	}
}
