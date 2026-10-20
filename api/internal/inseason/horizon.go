package inseason

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The rest-of-season order's horizon follows the league (Lane 96, B25):
// a league's order values its weeks through the league's last title week
// as its platform states it, where the published run's points stop at
// LastWeek. The run's points a game carry the extra week: a club's points
// are the run's times its games left through the league's last week over
// its games at the run through LastWeek (LiveBoard), the rule that already
// takes the games played since the run out of them. A read with no league,
// and a league whose platform states no playoffs, keep the run's horizon.

// MaxWeek is the last week any league's order values: the regular
// season's eighteenth.
const MaxWeek = 18

// twoWeekFinal is the championship's length the words name.
const twoWeekFinal = 2

// Horizon is the last week a rest-of-season order values, and how many
// weeks the league's championship runs (0 when its platform does not say).
type Horizon struct {
	Last       int
	FinalWeeks int
}

// StandardHorizon is the run's own: through LastWeek, no championship
// named.
var StandardHorizon = Horizon{Last: LastWeek}

// HorizonOf is a league's horizon from its platform's terms: its last
// playoff week when the platform states one within the season, else the
// run's.
func HorizonOf(t leaguesync.Terms) Horizon {
	if t.PlayoffLast < 1 || t.PlayoffLast > MaxWeek || t.PlayoffFirst < 1 || t.PlayoffFirst > t.PlayoffLast {
		return StandardHorizon
	}
	return Horizon{Last: t.PlayoffLast, FinalWeeks: t.FinalWeeks}
}

// finalWords is the clause naming a two-week championship inside the
// span ", the final over weeks 17 and 18", empty for a one-week final or
// one its platform does not state, or one that starts before from.
func (h Horizon) finalWords(from int) string {
	if h.FinalWeeks != twoWeekFinal || h.Last-1 < from {
		return ""
	}
	return fmt.Sprintf(", the final over weeks %d and %d", h.Last-1, h.Last)
}
