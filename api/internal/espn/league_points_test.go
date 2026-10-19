package espn

import (
	"strings"
	"testing"
)

// The mid-week fixture is the in-play league read again with the same
// views on the Monday of period 6 (2026-10-19 10:33Z): Sunday's games
// final, Monday night's still to kick off. It is trimmed as Lane 74's is,
// on Lane 74's anonymised template (every member's id and name and every
// team's name replaced), with each side's rosterForCurrentScoringPeriod
// cut to the player, his slot, his week's appliedStatTotal and his lock
// (Lane 79).
const midWeekFixture = "testdata/league-inplay-2026-week6-monday.json"

// Players in the mid-week fixture's game 9 v 3.
const (
	walker    = "4567048"  // team 9 RB, played Sunday: 27.9
	stafford  = "12483"    // team 9 QB, played: 16.88
	mccaffrey = "3117251"  // team 9 RB, plays Monday night: 0.0, unlocked
	houstonDS = "-16034"   // team 9 D/ST, played: -2.0
	mcconkey  = "4612826"  // team 9 bench, played: 2.7
	stribling = "4710714"  // team 9 IR, unlocked: 0.0
	stroud    = "4432577"  // team 3 bench, played: 22.98
	caleb     = "4431611"  // team 3 QB, played: 16.5
	djMoore   = "3915416"  // team 3 FLEX, played: 0.0, locked
	gibbsLate = "4429795"  // team 3 bench, unlocked: 0.0
	offRoster = "99999999" // no team's
)

// Lane 79: mid-week, each side carries every rostered player's points
// for the scoring period from rosterForCurrentScoringPeriod, starters,
// bench and IR alike: the live figure for a player whose game has
// started, 0.0 for one still to kick off. The team's points stay ESPN's
// totalPointsLive.
func TestReadMidWeekCarriesEachPlayersPoints(t *testing.T) {
	l := readBody(t, readFixture(t, midWeekFixture), 2026)
	g := gameOf(t, l, 9)
	if g.Home != 9 || g.Away != 3 || g.HomePoints != 77.08 || g.Points != 76.8 {
		t.Fatalf("game 9 v 3: %+v", g)
	}
	if len(g.HomePlayerPoints) != 17 || len(g.PlayerPoints) != 17 {
		t.Fatalf("players keyed: %d home, %d away", len(g.HomePlayerPoints), len(g.PlayerPoints))
	}
	for id, want := range map[string]float64{walker: 27.9, stafford: 16.88, mccaffrey: 0, houstonDS: -2, mcconkey: 2.7, stribling: 0} {
		if got, ok := g.HomePlayerPoints[id]; !ok || got != want {
			t.Fatalf("team 9 player %s: %v %v, want %v", id, got, ok, want)
		}
	}
	for id, want := range map[string]float64{stroud: 22.98, caleb: 16.5, djMoore: 0, gibbsLate: 0} {
		if got, ok := g.PlayerPoints[id]; !ok || got != want {
			t.Fatalf("team 3 player %s: %v %v, want %v", id, got, ok, want)
		}
	}
	if _, ok := g.HomePlayerPoints[stroud]; ok {
		t.Fatal("team 3's player keyed on team 9's side")
	}
	for _, g := range l.Games {
		if g.HomePlayerPoints == nil || g.PlayerPoints == nil {
			t.Fatalf("a side with no player's points: %+v", g)
		}
	}
}

// Once ESPN decides the matchup, the team's points are its final and
// each player's are still his appliedStatTotal for the period, the
// final's own figures.
func TestReadFinalCarriesEachPlayersPoints(t *testing.T) {
	in := string(readFixture(t, midWeekFixture))
	const live = `"matchupPeriodId":6,"winner":"UNDECIDED","home":{"teamId":9,"totalPoints":0.0,"totalPointsLive":77.08`
	if !strings.Contains(in, live) {
		t.Fatal("the fixture's game 9 v 3 moved")
	}
	final := strings.Replace(in, live, `"matchupPeriodId":6,"winner":"HOME","home":{"teamId":9,"totalPoints":91.3,"totalPointsLive":77.08`, 1)
	final = strings.Replace(final, `"playerId":3117251,"lineupSlotId":2,"playerPoolEntry":{"appliedStatTotal":0.0,"lineupLocked":false}`,
		`"playerId":3117251,"lineupSlotId":2,"playerPoolEntry":{"appliedStatTotal":14.22,"lineupLocked":true}`, 1)
	g := gameOf(t, readBody(t, []byte(final), 2026), 9)
	if g.HomePoints != 91.3 || g.HomePlayerPoints[mccaffrey] != 14.22 || g.HomePlayerPoints[walker] != 27.9 {
		t.Fatalf("a decided game: %v, McCaffrey %v, Walker %v", g.HomePoints, g.HomePlayerPoints[mccaffrey], g.HomePlayerPoints[walker])
	}
}

// A read without rosterForCurrentScoringPeriod (Lane 74's fixture, read
// with the same views before ESPN carried it on Sunday night, and the
// 2019 league's finals) gives no player's points: the sides carry ESPN's
// team totals alone.
func TestReadWithoutCurrentRosterGivesNoPlayersPoints(t *testing.T) {
	for _, read := range []struct {
		name   string
		season int
	}{{inPlayFixture, 2026}, {fullFixture, 2019}} {
		for _, g := range readBody(t, readFixture(t, read.name), read.season).Games {
			if g.HomePlayerPoints != nil || g.PlayerPoints != nil {
				t.Fatalf("%s: player's points from nowhere: %+v", read.name, g)
			}
		}
	}
}

// A rostered player ESPN leaves out of the period's roster follows Lane
// 74's locked-starter rule: still to kick off (unlocked on the team's
// roster), he has scored 0.0; kicked off, his points are not known and
// he is left out, never a 0.0. A player on no roster is never keyed.
func TestReadPlayerMissingFromCurrentRoster(t *testing.T) {
	in := string(readFixture(t, midWeekFixture))
	drop := func(body, entry string) string {
		if !strings.Contains(body, entry) {
			t.Fatalf("the fixture lacks %s", entry)
		}
		return strings.Replace(body, entry, `{"playerId":`+offRoster+`,"lineupSlotId":20,"playerPoolEntry":{"appliedStatTotal":5.0,"lineupLocked":true}}`, 1)
	}
	body := drop(in, `{"playerId":3117251,"lineupSlotId":2,"playerPoolEntry":{"appliedStatTotal":0.0,"lineupLocked":false}}`)
	body = drop(body, `{"playerId":4567048,"lineupSlotId":2,"playerPoolEntry":{"appliedStatTotal":27.900000000000002,"lineupLocked":true}}`)
	g := gameOf(t, readBody(t, []byte(body), 2026), 9)
	if got, ok := g.HomePlayerPoints[mccaffrey]; !ok || got != 0 {
		t.Fatalf("an unlocked starter left out: %v %v", got, ok)
	}
	if got, ok := g.HomePlayerPoints[walker]; ok {
		t.Fatalf("a kicked-off starter left out read as %v", got)
	}
	if _, ok := g.HomePlayerPoints[offRoster]; ok {
		t.Fatal("a player on no roster keyed")
	}
}
