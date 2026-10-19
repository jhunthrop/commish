package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Every figure a row shows is rounded once, here, by the site's rule (Lane
// 66k H1): his points a game, his last game and his points this week leave
// the API as the tenth the screen prints, half away from zero on the
// decimal, so the web prints them as given.
func TestRowFiguresLeaveAsTheTenth(t *testing.T) {
	_, avg, last := evidence(Facts{PerGame: ptr(9.45), LastGames: []GamePoints{{Week: 5, Points: 1.15}}})
	if avg == nil || *avg != 9.5 || last == nil || *last != 1.2 {
		t.Fatalf("avg %v last %v, want 9.5 and 1.2", orNone(avg), orNone(last))
	}
	side := &leaguesync.Side{Starters: []string{"h1"}, PlayerPoints: map[string]float64{"h1": 10.35}}
	if got := thisWeek(leaguesync.HostSleeper, side, "h1", Facts{Locked: true}); got == nil || *got != 10.4 {
		t.Fatalf("points this week %v, want 10.4", orNone(got))
	}
	facts := wireFacts(Facts{LastGames: []GamePoints{{Week: 5, Points: 0.25}}}, nil)
	if facts.LastGames[0].Points != 0.3 {
		t.Fatalf("last games %v, want 0.3", facts.LastGames[0].Points)
	}
}

// The scoreboard's points are the platform's, sent as the tenth the bug
// prints.
func TestScoreboardPointsLeaveAsTheTenth(t *testing.T) {
	f := newFixture(t)
	for i := range f.league.Snap.Matchups {
		f.league.Snap.Matchups[i].Points = 9.45
	}
	a := newFixtureAdvisor(t, f, nil)
	for _, g := range a.Scoreboard().Games {
		for _, s := range g.Sides {
			if s.Points != 9.5 {
				t.Fatalf("side %d points %v, want 9.5", s.RosterId, s.Points)
			}
		}
	}
}
