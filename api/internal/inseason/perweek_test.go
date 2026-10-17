package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A week's figure is the order's points over replacement averaged over
// the weeks the order covers: the season's 17 on the preseason number,
// the weeks left from the league's week on the rest-of-season order.
func TestWeeksCovered(t *testing.T) {
	cases := []struct {
		basis OrderBasis
		week  int
		want  int
	}{
		{Preseason, 3, 17}, {Preseason, 9, 17}, {RestOfSeason, 7, 11}, {RestOfSeason, 17, 1}, {RestOfSeason, 18, 1},
		{RestOfSeason, 0, 17},
	}
	for _, c := range cases {
		if got := WeeksCovered(c.basis, c.week); got != c.want {
			t.Errorf("%s week %d: %d weeks, want %d", c.basis, c.week, got, c.want)
		}
	}
	if !near(PerWeek(110, 11), 10) {
		t.Fatalf("per week %v", PerWeek(110, 11))
	}
}

// The waiver gain is a week's on the order's weeks.
func TestWaiverGainOverTheOrdersWeeks(t *testing.T) {
	got := Waivers(twelveTeamPPR(t), 11, Squad{Players: pprRoster()}, []Candidate{player("fa-rb", draft.RB, 15, 60)})[0]
	if !near(got.Gain, (60-25)/11.0) {
		t.Fatalf("gain %v, want %v", got.Gain, (60-25)/11.0)
	}
}

// Every basis says what "a week" is, and the start and sit line says we
// ranks by no week's projection on either order (M2, Lane 66d), with no
// week of its own printed.
func TestBasisSaysWhatAWeekIs(t *testing.T) {
	settings := fixtureSettings()
	ros := WaiversBasis(RestOfSeason, 11)
	for _, s := range []string{LineupBasis(RestOfSeason), LineupBasis(Preseason)} {
		if strings.Contains(s, "Points over replacement") {
			t.Errorf("the lineup's rows show no points over replacement: %q", s)
		}
	}
	pre := LineupBasis(Preseason)
	for _, s := range []string{LineupBasis(RestOfSeason), pre} {
		if !strings.Contains(s, "and this week's designations, not by a week's projection.") || strings.Contains(s, "from week") {
			t.Errorf("%q", s)
		}
	}
	if !strings.Contains(ros, "the rest of the season on our rest-of-season order, averaged over its 11 weeks") {
		t.Errorf("%q", ros)
	}
	if !strings.Contains(WaiversBasis(Preseason, 17), "the season on our preseason number, averaged over its 17 weeks") {
		t.Errorf("%q", WaiversBasis(Preseason, 17))
	}
	if one := TradesBasis(RestOfSeason, 1); !strings.Contains(one, "averaged over its one week") {
		t.Errorf("%q", one)
	}
	// The basis above the rows is short: the league's shape and the rules
	// points so far leave out are the note under them.
	if strings.Contains(ros, "12-team") || !strings.Contains(BasisNote(settings), "for a 12-team league with 1 QB, 2 RB, 3 WR, 1 TE and a flex") {
		t.Errorf("basis %q note %q", ros, BasisNote(settings))
	}
}

// The weeks come from the run's own first week when the table says it,
// not the league's: a run that rolled to week 8 while the host still
// says 7 divides by 10, and the basis names 10 (the waiver page's, whose
// rows show the figure). Without the run's week the league's stands.
func TestTheRunsFirstWeekSetsTheDivisor(t *testing.T) {
	f := newFixture(t)
	f.league.Board.Order = boards.OrderRestOfSeason
	f.league.Board.FromWeek = 8
	f.league.Snap.Week = 7
	a := newFixtureAdvisor(t, f, nil)
	out, _ := a.Lineup()
	line := out.Slots[0].Ours
	season := f.league.Board.Values[boardID(line)]
	w, _ := a.Waivers("")
	if *line.PointsOverReplacement != roundTenth(season/10) || !strings.Contains(w.Basis, "its 10 weeks") {
		t.Fatalf("%v %q", *line.PointsOverReplacement, w.Basis)
	}
	f.league.Board.FromWeek = 0
	if w, _ := newFixtureAdvisor(t, f, nil).Waivers(""); !strings.Contains(w.Basis, "its 11 weeks") {
		t.Fatalf("the league's week: %q", w.Basis)
	}
	// A preseason board's from week is never read.
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderPreseason, 8
	if w, _ := newFixtureAdvisor(t, f, nil).Waivers(""); !strings.Contains(w.Basis, "its 17 weeks") {
		t.Fatalf("preseason: %q", w.Basis)
	}
}

// A row's points over replacement is a week's on the order's weeks.
func TestPlayerLineOverTheOrdersWeeks(t *testing.T) {
	f := newFixture(t)
	f.league.Board.Order = boards.OrderRestOfSeason
	f.league.Snap.Week = 7
	out, _ := newFixtureAdvisor(t, f, nil).Lineup()
	line := out.Slots[0].Ours
	season := f.league.Board.Values[boardID(line)]
	if line.PointsOverReplacement == nil || *line.PointsOverReplacement != roundTenth(season/11) {
		t.Fatalf("points over replacement %v, want %v", line.PointsOverReplacement, roundTenth(season/11))
	}
	if out.OrderBasis != apitypes.OrderBasisRestOfSeason || out.BasisNote != LineupNote(*f.league.Saved) {
		t.Fatalf("%s %q", out.OrderBasis, out.BasisNote)
	}
}
