package inseason

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The week before kickoff on FFPC (Lane 127, B105): Thursday's CIN at CLE
// final, every other club to play Sunday, and a Friday clock.
var (
	ffpcThursday = time.Date(2026, 10, 15, 20, 15, 0, 0, east)
	ffpcFriday   = time.Date(2026, 10, 16, 12, 0, 0, 0, east)
)

// rosterProj is each template spot's week projection (rosterTemplate's
// order) for the two rosters the test sets: two quarterbacks in a one-QB
// league, the second the better; four backs, five receivers, two tight
// ends. The kicker and the defense leave the rosters.
var rosterProj = []float64{20, 10, 11, 5, 6, 7, 4, 12, 0, 0, 25, 13, 8, 3, 9}

// rosterOf gives roster's players their rosterProj figures, takes out the
// kicker and the defense, and the tight ends where noTE: its players are
// the fixture's p<NNN> board ids, fifteen a team in roster order.
func rosterOf(f *fixture, projection boards.WeekProjection, roster int, noTE bool) {
	team := &f.league.Snap.Teams[roster-1]
	var keep []string
	for i, position := range rosterTemplate() {
		id := fmt.Sprintf("p%03d", (roster-1)*len(rosterTemplate())+i)
		switch {
		case position == draft.K || position == draft.DEF, noTE && position == draft.TE:
			continue
		}
		projection.Players[id] = boards.ProjectedPoints{PPR: rosterProj[i], Half: rosterProj[i], Standard: rosterProj[i]}
		keep = append(keep, team.Players[i])
	}
	team.Players = keep
}

// The best lineup by hand under the fixture's slots (QB, RB 2, WR 3, TE,
// one RB/WR/TE flex, K, DEF): QB 25 (the 20 sits), RB 13 and 12, WR 9, 8
// and 7, TE 4, flex the best left, the 11 back; no kicker or defense.
const (
	bestWithTE = 25 + 13 + 12 + 9 + 8 + 7 + 4 + 11
	// Short of a tight end: his slot stays empty and the flex is the same back.
	bestWithoutTE = bestWithTE - 4
)

// B105 (Lane 127): before Sunday an FFPC side listing no starters has a
// Proj from our best lineup of its roster, said so on the wire; one with
// no roster read has none, and the member's side keeps its starters' sum.
// Friday after Thursday's game, the CIN and CLE players locked, they still
// count; the Proj final stays none for every unlisted side.
func TestAnFFPCSideWithNoStartersProjectsItsRostersBestLineup(t *testing.T) {
	f := pairedFixture(t)
	projection := weekProjection(f)
	for i := range f.data.Games {
		g := &f.data.Games[i]
		if g.Week != 6 {
			continue
		}
		if g.Team == "CIN" || g.Team == "CLE" {
			g.Kickoff, g.Final = ffpcThursday, true
		}
	}
	// The fixture's last two clubs are on bye in week 6: here they play, so every spot can.
	f.data.Games = append(f.data.Games, game(6, "TEN", "WSH", liveSunday, false)...)
	me, them := ffpcBoard(&f)
	rosterOf(&f, projection, 3, false)
	rosterOf(&f, projection, 4, true)
	s := ffpcService(t, f, projection, ffpcFriday)
	board := scoreboardOf(t, s)
	for _, tc := range []struct {
		roster int
		want   *float64
	}{
		{3, ptr(bestWithTE)},
		{4, ptr(bestWithoutTE)},
		// Rosterless (ffpcRosterless): no roster to draw a lineup from.
		{7, nil},
		{8, nil},
	} {
		_, side := sideOf(t, board, tc.roster)
		if (side.Projection == nil) != (tc.want == nil) || (tc.want != nil && *side.Projection != *tc.want) {
			t.Errorf("team %d Proj %v, want %v", tc.roster, deref(side.Projection), deref(tc.want))
		}
		wantFlag := tc.want != nil
		if (side.ProjectionBestLineup != nil && *side.ProjectionBestLineup) != wantFlag {
			t.Errorf("team %d projection_best_lineup %v, want %v", tc.roster, side.ProjectionBestLineup, wantFlag)
		}
		if side.ProjectedFinal != nil {
			t.Errorf("team %d with no starters has a projected final %v", tc.roster, *side.ProjectedFinal)
		}
	}
	if _, mine := sideOf(t, board, me); mine.ProjectionBestLineup != nil || mine.Projection == nil {
		t.Errorf("the member's side: Proj %v best lineup %v, want his starters' sum alone", mine.Projection, mine.ProjectionBestLineup)
	}
	// The opponent keeps his roster (Lane 124): his Proj is its best lineup too.
	if _, theirs := sideOf(t, board, them); theirs.ProjectionBestLineup == nil || !*theirs.ProjectionBestLineup {
		t.Errorf("the opponent's projection_best_lineup %v", theirs.ProjectionBestLineup)
	}
}

// The lineup rule fills each position's own slots before the flex, the
// better of two quarterbacks in a one-QB league, nobody who cannot play:
// a back out this week gives his place to the next.
func TestTheBestLineupTakesTheBetterQuarterbackAndLeavesAnEmptySlotEmpty(t *testing.T) {
	f := pairedFixture(t)
	f.data.Games = append(f.data.Games, game(6, "TEN", "WSH", liveSunday, false)...)
	projection := weekProjection(f)
	rosterOf(&f, projection, 4, true)
	a, err := newAdvisor(f.league, f.data, projection, nil, fixtureNow, nil)
	if err != nil {
		t.Fatal(err)
	}
	team, _ := f.league.Snap.TeamByRoster(4)
	lines := bestLineup(a.config, a.active(team))
	var positions []string
	for _, l := range lines {
		positions = append(positions, l.Player.Position)
	}
	slices.Sort(positions)
	if want := []string{"QB", "RB", "RB", "RB", "WR", "WR", "WR"}; !slices.Equal(positions, want) {
		t.Fatalf("lineup positions %v, want %v (no TE held, no K or DEF)", positions, want)
	}
	for _, l := range lines {
		if l.Player.Position == "QB" && (l.WeekProjection == nil || *l.WeekProjection != 25) {
			t.Fatalf("the quarterback started %v, want the 25", deref(l.WeekProjection))
		}
	}
}
