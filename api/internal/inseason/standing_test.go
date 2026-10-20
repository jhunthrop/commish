package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// namedOpponents gives the opponent's two starters still to play on the
// live Sunday (h015, DEN; h024, the DAL defense) names a sentence can
// second-mention.
func namedOpponents(f *fixture) {
	named := f.league.Player
	f.league.Player = func(id string) apitypes.LeaguePlayer {
		p := named(id)
		switch id {
		case "h015":
			p.Name = "Christian McCaffrey"
		case "h024":
			p.Name = "Cowboys D/ST"
		}
		return p
	}
}

// finishTeam turns a club's week 6 game final.
func finishTeam(f *fixture, teams ...string) {
	for i, g := range f.data.Games {
		for _, team := range teams {
			if g.Week == 6 && g.Team == team {
				f.data.Games[i].Final = true
			}
		}
	}
}

// standingOfBox is the matchup answer's standing and decided, failing the
// test where either is missing.
func standingOfBox(t *testing.T, box apitypes.MatchupBox) (string, bool) {
	t.Helper()
	if box.Standing == nil || box.Decided == nil {
		t.Fatalf("standing %v, decided %v", box.Standing, box.Decided)
	}
	guard(t, *box.Standing)
	return *box.Standing, *box.Decided
}

// While the game plays the bug says the margin and who is left on each
// side (Lane 99, B31), from the member's side, by the to-play rule.
func TestStandingWhileBothSidesPlay(t *testing.T) {
	f, projection := liveFixture(t)
	words, decided := standingOfBox(t, matchupOf(t, liveService(t, f, projection)))
	if words != "Up 10.0, 1 of yours and 2 of theirs to play" || decided {
		t.Errorf("standing %q decided %v", words, decided)
	}
}

// With nobody of the member's left and the other side's starters named,
// the side behind with nobody left is decided; ahead it is not.
func TestStandingNamesTheOtherSideOnceOneHasNobodyLeft(t *testing.T) {
	f, projection := liveFixture(t)
	namedOpponents(&f)
	finishTeam(&f, "CIN", "CLE")
	f.league.Snap.Matchups[0].Points = 30
	words, decided := standingOfBox(t, matchupOf(t, liveService(t, f, projection)))
	if words != "Down 10.0 with nobody left, McCaffrey and Cowboys to play for them" || !decided {
		t.Errorf("behind: %q decided %v", words, decided)
	}
	f.league.Snap.Matchups[0].Points = 50
	words, decided = standingOfBox(t, matchupOf(t, liveService(t, f, projection)))
	if words != "Up 10.0 with nobody left, McCaffrey and Cowboys to play for them" || decided {
		t.Errorf("ahead: %q decided %v", words, decided)
	}
}

// The other side done while the member's still plays: the member's own
// starter named, and the opponent behind with nobody left is decided.
func TestStandingNamesTheMembersOwnWhenTheyHaveNobodyLeft(t *testing.T) {
	f, projection := liveFixture(t)
	finishTeam(&f, "DAL", "DEN")
	monday := time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	for i, g := range f.data.Games {
		if g.Week == 6 && (g.Team == "DAL" || g.Team == "DEN") && g.Kickoff.Equal(monday) {
			f.data.Games[i].Kickoff = liveSunday.Add(-4 * time.Hour)
		}
	}
	named := f.league.Player
	f.league.Player = func(id string) apitypes.LeaguePlayer {
		p := named(id)
		if id == "h001" {
			p.Name = "George Kittle"
		}
		return p
	}
	words, decided := standingOfBox(t, matchupOf(t, liveService(t, f, projection)))
	if words != "Up 10.0, they have nobody left, Kittle playing for you" || !decided {
		t.Errorf("standing %q decided %v", words, decided)
	}
}

// Once every starter is final the result: won, lost or tied, never a
// count; decided is false (the state word is Final).
func TestStandingOnceFinalIsTheResult(t *testing.T) {
	for _, c := range []struct {
		mine float64
		want string
	}{{50, "Won by 10.0"}, {9.6, "Lost by 30.4"}, {40, "Tied"}} {
		f, projection := liveFixture(t)
		finishTeam(&f, "CIN", "CLE", "DAL", "DEN")
		f.league.Snap.Matchups[0].Points = c.mine
		words, decided := standingOfBox(t, matchupOf(t, liveService(t, f, projection)))
		if words != c.want || decided {
			t.Errorf("%v: %q decided %v, want %q", c.mine, words, decided, c.want)
		}
	}
}

// Before the first kickoff, with a score unread or with no lineup shown
// for the opponent (FFPC) the bug says nothing.
func TestStandingSaysNothingWithoutBothScoresUnderWay(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	if box := matchupOf(t, s); box.Standing != nil || box.Decided != nil {
		t.Errorf("before kickoff %v %v", box.Standing, box.Decided)
	}
	unread, projection := liveFixture(t)
	unread.league.Snap.Matchups[1].PointsUnread = true
	if box := matchupOf(t, liveService(t, unread, projection)); box.Standing != nil {
		t.Errorf("an unread score says %q", *box.Standing)
	}
	hidden, projection := liveFixture(t)
	hidden.league.Snap.Matchups[1].Starters = nil
	if box := matchupOf(t, liveService(t, hidden, projection)); box.Standing != nil {
		t.Errorf("an opponent with no lineup shown says %q", *box.Standing)
	}
}

// The words themselves: names past three are counted, a side with some
// in play and some to come says both.
func TestStandingWords(t *testing.T) {
	for _, c := range []struct {
		margin       float64
		mine, theirs sideLeft
		want         string
	}{
		{3.2, sideLeft{playing: []string{"Hall"}, coming: []string{"Pitts"}}, sideLeft{coming: []string{"Kittle"}},
			"Up 3.2, 2 of yours and 1 of theirs to play"},
		{-14.1, sideLeft{}, sideLeft{playing: []string{"McCaffrey"}, coming: []string{"Kittle"}},
			"Down 14.1 with nobody left, McCaffrey playing and Kittle to play for them"},
		{-2, sideLeft{}, sideLeft{coming: []string{"A", "B", "C", "D"}}, "Down 2.0 with nobody left, 4 to play for them"},
		{0, sideLeft{playing: []string{"Hall", "Pitts", "Kittle"}}, sideLeft{},
			"Tied, they have nobody left, Hall, Pitts and Kittle playing for you"},
	} {
		got := StandingWords(c.margin, c.mine, c.theirs)
		guard(t, got)
		if got != c.want {
			t.Errorf("StandingWords(%v) = %q, want %q", c.margin, got, c.want)
		}
	}
	if got := secondMention("Texans D/ST"); got != "Texans" {
		t.Errorf("a defense's second mention %q", got)
	}
}

// missFixture is the live Sunday with every week 6 game final, the
// member's RB h002 ruled out and scoring 0, each other starter 5 and each
// bench player 8.7 on a platform that gives every player's points.
func missFixture(t *testing.T) (fixture, boards.WeekProjection) {
	t.Helper()
	f, projection := liveFixture(t)
	finishTeam(&f, "CIN", "CLE", "DAL", "DEN")
	f.data.Designations = map[string]boards.Designation{"p002": {Code: "O", AsOf: liveSunday.Add(-48 * time.Hour)}}
	for i := range f.league.Snap.Matchups[:2] {
		for _, id := range f.league.Snap.Matchups[i].Starters {
			f.league.Snap.Matchups[i].PlayerPoints[id] = 5
		}
	}
	for _, id := range []string{"h010", "h011", "h012", "h013", "h014"} {
		f.league.Snap.Matchups[0].PlayerPoints[id] = 8.7
	}
	f.league.Snap.Matchups[0].PlayerPoints["h002"] = 0
	return f, projection
}

// Once the week is final the Lineup's strip says where the lineup as set
// missed our pick (Lane 99, B11): each such slot with what both scored,
// then what our lineup would have scored. The lineup itself stays as set,
// every game past kickoff.
func TestMissLineOnceTheWeekIsFinal(t *testing.T) {
	f, projection := missFixture(t)
	lineup := lineupOf(t, liveService(t, f, projection))
	for _, s := range lineup.Slots {
		if s.Changed {
			t.Errorf("%s changed on a final week", s.Slot)
		}
	}
	want := "Player 002, Out, scored 0.0 in your RB while Player 011 scored 8.7 on your bench. " +
		"Player 006 scored 5.0 in your TE while Player 013 scored 8.7 on your bench. " +
		"Player 007 scored 5.0 in your Flex while Player 012 scored 8.7 on your bench. " +
		"Our lineup would have scored 56.1."
	if lineup.Missed == nil || *lineup.Missed != want {
		t.Fatalf("missed %v\nwant %q", lineup.Missed, want)
	}
	guard(t, *lineup.Missed)
}

// While a named slot's game plays its points are "has", and our lineup's
// total waits for every game to be final.
func TestMissLineWhileTheWeekPlays(t *testing.T) {
	f, projection := missFixture(t)
	for i, g := range f.data.Games {
		// The member's h001 (CLE) back in play.
		if g.Week == 6 && (g.Team == "CIN" || g.Team == "CLE") {
			f.data.Games[i].Final = false
		}
	}
	lineup := lineupOf(t, liveService(t, f, projection))
	if lineup.Missed == nil {
		t.Fatal("no miss line while the week plays")
	}
	got := *lineup.Missed
	if want := "Player 002, Out, scored 0.0 in your RB while Player 011 scored 8.7 on your bench."; !strings.HasPrefix(got, want) {
		t.Errorf("missed %q, want it to open %q", got, want)
	}
	if strings.Contains(got, "would have scored") {
		t.Errorf("a total before every game is final: %q", got)
	}
}

// Before a differing slot kicks off, and where the platform gives no
// player's points, the strip has no miss line.
func TestMissLineNeedsKickoffAndPoints(t *testing.T) {
	f, projection := liveFixture(t)
	f.data.Designations = map[string]boards.Designation{"p002": {Code: "O", AsOf: liveSunday.Add(-48 * time.Hour)}}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: projection}
	if lineup := lineupOf(t, s); lineup.Missed != nil {
		t.Errorf("before kickoff %q", *lineup.Missed)
	}
	quiet, projection := missFixture(t)
	quiet.league.Snap.Matchups[0].PlayerPoints = map[string]float64{}
	if lineup := lineupOf(t, liveService(t, quiet, projection)); lineup.Missed != nil {
		t.Errorf("with no player's points %q", *lineup.Missed)
	}
}
