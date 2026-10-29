package leaguesync

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// h2h is a final head-to-head game.
func h2h(week, a, b int, pa, pb float64) ScheduledGame {
	return ScheduledGame{Week: week, RosterIDs: []int{a, b}, Points: []float64{pa, pb}, Final: true}
}

// ahead2 is a head-to-head game to come.
func ahead2(week, a, b int) ScheduledGame {
	return ScheduledGame{Week: week, RosterIDs: []int{a, b}}
}

// syntheticLeague is four teams, two playoff seats by record, a four-week
// regular season with three weeks played: A 3-0, B 2-1, C 1-2, D 0-3, B and
// C level on points for at the same rate. Week 4 is A at D and B at C.
// A has clinched (no one else can reach three wins), D is out (three teams
// have more wins than D can reach), and the second seat goes to whoever
// wins B at C (a C win leaves the two level at 2-2, and the winner then
// has more points for): a known answer of 100, 50, 50 and 0.
func syntheticLeague() Snapshot {
	teams := []Team{
		{RosterID: 1, Name: "A", Wins: 3, PointsFor: 360},
		{RosterID: 2, Name: "B", Wins: 2, Losses: 1, PointsFor: 300},
		{RosterID: 3, Name: "C", Wins: 1, Losses: 2, PointsFor: 300},
		{RosterID: 4, Name: "D", Losses: 3, PointsFor: 255},
	}
	schedule := []ScheduledGame{
		h2h(1, 1, 4, 120, 80), h2h(1, 2, 3, 110, 100),
		h2h(2, 1, 3, 120, 105), h2h(2, 2, 4, 95, 90),
		h2h(3, 1, 2, 120, 95), h2h(3, 3, 4, 95, 85),
		ahead2(4, 1, 4), ahead2(4, 2, 3),
	}
	return Snapshot{
		Ref: Ref{Host: HostSleeper, LeagueID: "1"}, Week: 4, Status: StatusInSeason, Teams: teams, Schedule: schedule,
		Terms: Terms{PlayoffTeams: 2, PlayoffFirst: 5, DivisionsRead: true},
	}
}

func TestPlayoffChanceOnASyntheticLeagueWithAKnownAnswer(t *testing.T) {
	c, ok := PlayoffChances(syntheticLeague())
	if !ok {
		t.Fatal("no chance")
	}
	if c.ByRoster[1] != 100 || c.ByRoster[4] != 0 {
		t.Fatalf("clinched and out: %v", c.ByRoster)
	}
	for _, id := range []int{2, 3} {
		if got := c.ByRoster[id]; got < 46 || got > 54 {
			t.Fatalf("team %d at %d, want 50 within the replays' error: %v", id, got, c.ByRoster)
		}
	}
	again, _ := PlayoffChances(syntheticLeague())
	if again.ByRoster[2] != c.ByRoster[2] {
		t.Fatal("the replays are seeded: the same read gives the same figure")
	}
	want := "Playoff chance from 2,000 replays of the schedule left, each team at its season rate, " +
		"scores varying week to week as this league's have. The top 2 by record make it. " +
		"Ties go by points for in the replays, as the platform's tie rule is not read, so a team tied at the cut when the season is over waits on the platform. " +
		"Only a clinched place reads 100 and only a team that is out reads 0."
	if c.Basis != want {
		t.Fatalf("basis %q", c.Basis)
	}
}

// A replayed figure never reads 100 or 0 unless it is proven: B and C's
// 50 apart, a team the replays always seat but the record does not prove
// reads 99.
func TestAnUnprovenCertaintyIsHeldTo99(t *testing.T) {
	snap := syntheticLeague()
	// B at 2-1 and C at 1-2 swap PF so that C can only take the seat by a
	// margin no draw reaches: C's rate collapses to 1 a game.
	snap.Teams[2].PointsFor = 3
	snap.Schedule[1].Points[1], snap.Schedule[2].Points[1], snap.Schedule[5].Points[0] = 1, 1, 1
	c, ok := PlayoffChances(snap)
	if !ok {
		t.Fatal("no chance")
	}
	if c.ByRoster[2] != 99 || c.ByRoster[3] != 1 {
		t.Fatalf("unproven figures %v, want 99 and 1", c.ByRoster)
	}
}

// settledLeague is the synthetic league with week 4 played: A 4-0, D 0-4,
// and B and C level at 2-2 for the last seat. C beat B in week 4 and has
// more points for; B beat C in week 1, so their head-to-head is even.
func settledLeague() Snapshot {
	snap := syntheticLeague()
	snap.Schedule[6], snap.Schedule[7] = h2h(4, 1, 4, 100, 99), h2h(4, 2, 3, 90, 140)
	snap.Teams[0].Wins, snap.Teams[0].PointsFor = 4, 460
	snap.Teams[3].Losses, snap.Teams[3].PointsFor = 4, 354
	snap.Teams[1].Losses, snap.Teams[1].PointsFor = 2, 390
	snap.Teams[2].Wins, snap.Teams[2].Losses, snap.Teams[2].PointsFor = 2, 2, 440
	return snap
}

// With no game left the field is settled, but a tie at the cut is broken
// only by the platform's rule as read (fix round 1, H2): under points for C
// takes the seat and every team is proven; under a rule not read, and under
// a head-to-head rule the season's games leave even, B and C hold 1 to 99
// while A and D stay proven; a head-to-head rule the games settle proves.
func TestTheSettledFieldBreaksATieOnlyByARuleRead(t *testing.T) {
	snap := settledLeague()
	snap.Terms.Tiebreak = TiebreakPointsFor
	c, _ := PlayoffChances(snap)
	if c.ByRoster[1] != 100 || c.ByRoster[3] != 100 || c.ByRoster[2] != 0 || c.ByRoster[4] != 0 {
		t.Fatalf("points for, read: %v", c.ByRoster)
	}
	for _, rule := range []string{"", TiebreakHeadToHead, TiebreakPointsAgainst, TiebreakDivisionRecord} {
		snap.Terms.Tiebreak = rule
		c, _ = PlayoffChances(snap)
		if c.ByRoster[1] != 100 || c.ByRoster[4] != 0 || c.ByRoster[2] != 1 || c.ByRoster[3] != 99 {
			t.Fatalf("rule %q leaves the tie open: %v", rule, c.ByRoster)
		}
	}
	// Head-to-head settles it when B beat C twice: B is seated, though C
	// has more points for.
	snap.Schedule[7] = h2h(4, 2, 3, 141, 140)
	snap.Teams[1].Wins, snap.Teams[1].Losses, snap.Teams[1].PointsFor = 3, 1, 470
	snap.Teams[2].Wins, snap.Teams[2].Losses, snap.Teams[2].PointsFor = 1, 3, 440
	snap.Teams[0].Wins, snap.Teams[0].Losses = 3, 1
	snap.Teams[3].Wins, snap.Teams[3].Losses = 1, 3
	snap.Schedule[6] = h2h(4, 1, 4, 99, 100)
	snap.Teams[0].PointsFor, snap.Teams[3].PointsFor = 459, 355
	snap.Terms.Tiebreak = TiebreakHeadToHead
	// A 3-1 and B 3-1 lead, C and D 1-3: a tie inside the field proves.
	c, _ = PlayoffChances(snap)
	if c.ByRoster[1] != 100 || c.ByRoster[2] != 100 || c.ByRoster[3] != 0 || c.ByRoster[4] != 0 {
		t.Fatalf("a head-to-head rule over a tie inside the field: %v", c.ByRoster)
	}
	snap.Terms.PlayoffTeams = 1
	c, _ = PlayoffChances(snap)
	// One seat: A and B level at 3-1, B with more points for, but A beat B
	// in week 3, so head-to-head seats A.
	if c.ByRoster[1] != 100 || c.ByRoster[2] != 0 {
		t.Fatalf("head-to-head over points for: %v", c.ByRoster)
	}
}

// An FFPC league seeds by its rules, seed 1 the best record, seed 2 the
// most points of the rest; its pages state no divisions.
func TestFFPCsSeeds(t *testing.T) {
	snap := settledLeague()
	snap.Ref.Host = HostFFPC
	snap.Terms = Terms{PlayoffFirst: 5, Seeds: []string{SeedRecord, SeedPoints}, DivisionsRead: true}
	snap.Teams[3].PointsFor = 445
	c, _ := PlayoffChances(snap)
	if c.ByRoster[1] != 100 || c.ByRoster[4] != 100 || c.ByRoster[3] != 0 {
		t.Fatalf("FFPC's seeds: %v", c.ByRoster)
	}
	if !strings.Contains(c.Basis, "Seeds 1 by record and 2 by points for make it") || strings.Contains(c.Basis, "Divisions") {
		t.Fatalf("FFPC's basis %q", c.Basis)
	}
}

// No figure where the league does not give what the replays read: no
// playoff seats, a week of the regular season the schedule lacks, or
// fewer than three weeks played.
func TestNoChanceWithoutItsInputs(t *testing.T) {
	cases := map[string]func(*Snapshot){
		"no seats":       func(s *Snapshot) { s.Terms.PlayoffTeams = 0 },
		"a week missing": func(s *Snapshot) { s.Schedule = s.Schedule[:6] },
		"two weeks played": func(s *Snapshot) {
			s.Schedule = append(s.Schedule[:4], ahead2(3, 1, 2), ahead2(3, 3, 4), ahead2(4, 1, 4), ahead2(4, 2, 3))
		},
		"no season's end": func(s *Snapshot) { s.Terms.PlayoffFirst = 0 },
	}
	for name, change := range cases {
		snap := syntheticLeague()
		change(&snap)
		if _, ok := PlayoffChances(snap); ok {
			t.Errorf("%s: a figure", name)
		}
	}
}

// A game against the week: the median and the average split the field by
// their mark, an all-play week seats the top half, a tie at the cut a win.
func TestTheMarksOfAGameAgainstTheWeek(t *testing.T) {
	score := map[int]float64{1: 100, 2: 90, 3: 90, 4: 60}
	if markOf(AgainstMedian, score) != 90 || markOf(AgainstAverage, score) != 85 {
		t.Fatal("median and average")
	}
	field := markOf(AgainstField, score)
	if !(90 > field) || !(field > 60) {
		t.Fatalf("the field's mark %v seats the two 90s", field)
	}
	wins := map[int]float64{}
	for id, s := range score {
		settleGame(wins, id, s, field)
	}
	if wins[1] != 1 || wins[2] != 1 || wins[3] != 1 || wins[4] != 0 {
		t.Fatalf("a tie at the cut wins: %v", wins)
	}
}

// The recorded ESPN league in week 6 has a figure for all twelve teams.
func TestPlayoffChanceOnTheRecordedESPNLeague(t *testing.T) {
	snap := espnSnapshot(espnRecorded(t, "league-inplay-2026-week6.json", 2026), time.Now())
	c, ok := PlayoffChances(snap)
	if !ok || len(c.ByRoster) != 12 {
		t.Fatalf("%v %v", ok, c.ByRoster)
	}
	sum := 0
	for _, pct := range c.ByRoster {
		sum += pct
	}
	// Six seats: the figures sum to about 600.
	if sum < 570 || sum > 630 {
		t.Fatalf("the figures sum to %d", sum)
	}
}

// Points against the median: each final week every team was scored, the
// member's points less the week's median, summed from printed tenths.
func TestPointsAgainstTheMedianOnASyntheticLeague(t *testing.T) {
	snap := syntheticLeague()
	got := pointsVsMedian(snap, 2)
	if got == nil || len(got.Weeks) != 3 {
		t.Fatalf("%+v", got)
	}
	// Week 1: 120 80 110 100, median 105, B 110 is +5. Week 2: 120 105 95 90,
	// median 100, B 95 is -5. Week 3: 120 95 95 85, median 95, B is 0.
	if got.Weeks[0].Median != 105 || got.Weeks[0].Diff != 5 || got.Weeks[1].Diff != -5 || got.Weeks[2].Diff != 0 {
		t.Fatalf("%+v", got.Weeks)
	}
	if got.Above != 1 || got.Total != 0 {
		t.Fatalf("above %d, total %v", got.Above, got.Total)
	}
	// A week a team was not scored is left out.
	snap.Schedule[0].Points = nil
	if got := pointsVsMedian(snap, 2); len(got.Weeks) != 2 {
		t.Fatalf("%+v", got.Weeks)
	}
	snap.Schedule = nil
	if pointsVsMedian(snap, 2) != nil {
		t.Fatal("no week, no figure")
	}
}

// The web fixture's copy of the chance sentence (a Sleeper league of six
// seats by record) is the API's word for word.
func TestTheWebFixtureCopiesTheChanceSentence(t *testing.T) {
	raw, err := os.ReadFile("../../../web/scripts/inseason-fixture/league-figures.ts")
	if err != nil {
		t.Fatal(err)
	}
	snap := Snapshot{Ref: Ref{Host: HostSleeper}, Terms: Terms{PlayoffTeams: 6, DivisionsRead: true}, Teams: make([]Team, 12)}
	if !strings.Contains(string(raw), `"`+chanceBasis(snap)+`"`) {
		t.Fatalf("the fixture's CHANCE_BASIS is not %q", chanceBasis(snap))
	}
}

// The new sentences keep the site's words: no betting or trading word, no
// dash or semicolon, "Playoff chance" never "odds", never "our model".
func TestChanceAndMedianSentencesKeepTheSitesWords(t *testing.T) {
	raw, err := os.ReadFile("../../../shared/words/banned-words.json")
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		BettingOnly   map[string]string `json:"bettingOnly"`
		BettingShared map[string]string `json:"bettingShared"`
		Trading       map[string]string `json:"trading"`
		Platform      map[string]string `json:"platform"`
		Marks         []string          `json:"marks"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	words := []string{"model"}
	for _, group := range []map[string]string{list.BettingOnly, list.BettingShared, list.Trading, list.Platform} {
		for p := range group {
			words = append(words, p)
		}
	}
	marks := make([]string, len(list.Marks))
	for i, m := range list.Marks {
		marks[i] = regexp.QuoteMeta(m)
	}
	banned := regexp.MustCompile(`(?i)\b(` + strings.Join(words, "|") + `)\b|` + strings.Join(marks, "|"))
	snap := syntheticLeague()
	sentences := []string{VsMedianBasis, chanceBasis(snap)}
	for _, tb := range []string{TiebreakHeadToHead, TiebreakPointsAgainst, TiebreakDivisionRecord} {
		snap.Terms.Tiebreak = tb
		sentences = append(sentences, chanceBasis(snap))
	}
	snap.Ref.Host, snap.Terms = HostFFPC, Terms{Seeds: []string{SeedRecord, SeedPoints, SeedRecord, SeedPoints}}
	sentences = append(sentences, chanceBasis(snap))
	for _, s := range sentences {
		if m := banned.FindString(s); m != "" {
			t.Errorf("%q says %q", s, m)
		}
	}
	if !strings.HasPrefix(sentences[1], "Playoff chance ") {
		t.Fatal("the label is Playoff chance")
	}
}
