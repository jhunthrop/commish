package inseason

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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
// count. Team 3's CIN receiver (8) has played, so its game reads kicked off
// and its Proj final is its 33 points plus the rest of the lineup, 81;
// team 4 plays it with nobody yet played, 34 plus its 85 (Lane 127 fix
// round 1). The rosterless teams have none.
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
		roster     int
		want, last *float64
	}{
		{3, ptr(bestWithTE), ptr(33 + bestWithTE - 8)},
		{4, ptr(bestWithoutTE), ptr(34 + bestWithoutTE)},
		// Rosterless (ffpcRosterless): no roster to draw a lineup from.
		{7, nil, nil},
		{8, nil, nil},
	} {
		_, side := sideOf(t, board, tc.roster)
		if (side.Projection == nil) != (tc.want == nil) || (tc.want != nil && *side.Projection != *tc.want) {
			t.Errorf("team %d Proj %v, want %v", tc.roster, deref(side.Projection), deref(tc.want))
		}
		wantFlag := tc.want != nil
		if (side.ProjectionBestLineup != nil && *side.ProjectionBestLineup) != wantFlag {
			t.Errorf("team %d projection_best_lineup %v, want %v", tc.roster, side.ProjectionBestLineup, wantFlag)
		}
		if (side.ProjectedFinal == nil) != (tc.last == nil) || (tc.last != nil && *side.ProjectedFinal != *tc.last) {
			t.Errorf("team %d Proj final %v, want %v", tc.roster, deref(side.ProjectedFinal), deref(tc.last))
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

// Lane 127 fix round 1: a side listing no starters with a roster read has
// a Proj final once its game reads kicked off, FFPC's points so far plus
// the Proj of its best lineup's players still to play: of team 3's five
// (QB on LV and RB on PHI final, RB on ARI in play, WRs on CLE and JAX to
// come) only the two receivers' 5 and 6 count, so 33 + 11 = 44, on the
// board; its Proj is all five's, 52. Team 7, with no roster, has neither.
func TestARosterSidesProjectedFinalAddsOnlyThePlayersStillToPlay(t *testing.T) {
	f := pairedFixture(t)
	projection := weekProjection(f)
	sunday := time.Date(2026, 10, 18, 14, 0, 0, 0, east)
	for i := range f.data.Games {
		g := &f.data.Games[i]
		if g.Week != 6 {
			continue
		}
		switch g.Team {
		case "LV", "MIA", "NYJ", "PHI":
			g.Kickoff, g.Final = sunday.Add(-5*time.Hour), true
		case "ARI", "ATL":
			g.Kickoff, g.Final = sunday.Add(-time.Hour), false
		default:
			g.Kickoff, g.Final = sunday.Add(2*time.Hour), false
		}
	}
	ffpcBoard(&f)
	team := &f.league.Snap.Teams[2]
	team.Players, team.Reserve, team.Taxi = team.Players[:5], nil, nil
	for i, proj := range []float64{20, 10, 11, 5, 6} {
		projection.Players[fmt.Sprintf("p%03d", 30+i)] = boards.ProjectedPoints{PPR: proj, Half: proj, Standard: proj}
	}
	board := scoreboardOf(t, ffpcService(t, f, projection, sunday))
	game, three := sideOf(t, board, 3)
	if game.State != apitypes.ScoreboardGameStatePlaying {
		t.Fatalf("team 3's game %s, want playing", game.State)
	}
	if deref(three.Projection) != 52.0 || deref(three.ProjectedFinal) != 44.0 {
		t.Errorf("team 3 Proj %v Proj final %v, want 52 and 44", deref(three.Projection), deref(three.ProjectedFinal))
	}
	if _, seven := sideOf(t, board, 7); seven.Projection != nil || seven.ProjectedFinal != nil || seven.ProjectionBestLineup != nil {
		t.Errorf("team 7 with no roster: Proj %v Proj final %v flag %v", deref(seven.Projection), deref(seven.ProjectedFinal), seven.ProjectionBestLineup)
	}
}
