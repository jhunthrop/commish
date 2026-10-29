package inseason

import (
	"fmt"
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
)

// The League screen's figures (Lane 292): each game's gap between the
// two sides' published projections, every team's power rank overall and
// at each starting spot, and the member's own start and sit record. Each
// figure's sentence is here, the one place the page reads it from.

// ProjectionGapBasis is what a game's projection_gap is. No win chance is
// given: the published projection exists for this season alone, whose
// outcomes are held out, so no spread for one is measured on a past season.
const ProjectionGapBasis = "Proj gap is your starters' published projection less your opponent's, " +
	"not a win chance: we show none until one is measured on a past season."

// powerWords is the power ranks' sentence: what they rank and over which
// weeks (tradeWeeks).
const powerWords = "Power ranks each team's best lineup by our order at each starting spot, 1 the strongest, %s, " +
	"byes counted. Kickers and defenses are not ranked."

// StartSitBasis is the member's start and sit record's sentence.
const StartSitBasis = "Your start and sit: weeks your set lineup started the same players our order picks " +
	"from your roster at quarterback, running back, receiver and tight end, and what our picks scored less " +
	"yours, on played weeks."

// powerColumns is the starting spots the power panel ranks, in the order
// it draws them. Kickers and defenses are left out: our order ranks
// neither (the K/DEF ruling).
var powerColumns = []struct {
	slot   draft.SlotType
	column apitypes.LeaguePowerColumn
}{
	{draft.SlotQB, apitypes.LeaguePowerColumnQB},
	{draft.SlotRB, apitypes.LeaguePowerColumnRB},
	{draft.SlotWR, apitypes.LeaguePowerColumnWR},
	{draft.SlotTE, apitypes.LeaguePowerColumnTE},
	{draft.SlotFlex, apitypes.LeaguePowerColumnFLEX},
	{draft.SlotSuperflex, apitypes.LeaguePowerColumnSUPERFLEX},
}

// projectionGap is the first side's printed projection less the second's,
// to the tenth; nil for a game with one side or a side with none.
func projectionGap(sides []apitypes.ScoreboardSide) *float64 {
	if len(sides) != 2 || sides[0].Projection == nil || sides[1].Projection == nil {
		return nil
	}
	gap := roundTenth(*sides[0].Projection - *sides[1].Projection)
	return &gap
}

// PowerTeam is one roster's power: its points over replacement over the
// span at each of the league's ranked columns, and their sum.
type PowerTeam struct {
	RosterID int
	Columns  []float64
	Total    float64
}

// PowerColumns is the ranked columns the league starts, in powerColumns'
// order.
func (l TradeLeague) PowerColumns() []apitypes.LeaguePowerColumn {
	var out []apitypes.LeaguePowerColumn
	for _, c := range powerColumns {
		for _, s := range l.slots {
			if s.Type == c.slot {
				out = append(out, c.column)
				break
			}
		}
	}
	return out
}

// Power is a roster's profile summed by ranked column (PowerColumns): each
// column's slots' points over replacement over the span.
func (l TradeLeague) Power(rosterID int, players []Candidate) PowerTeam {
	profile := l.Profile(players)
	columns := l.PowerColumns()
	out := PowerTeam{RosterID: rosterID, Columns: make([]float64, len(columns))}
	for i, s := range l.slots {
		for j, c := range columns {
			if columnOf(s.Type) == c {
				out.Columns[j] += profile.Slots[i]
				out.Total += profile.Slots[i]
			}
		}
	}
	return out
}

// columnOf is the ranked column a slot type falls in, empty for one not
// ranked.
func columnOf(t draft.SlotType) apitypes.LeaguePowerColumn {
	for _, c := range powerColumns {
		if c.slot == t {
			return c.column
		}
	}
	return ""
}

// PowerRanks ranks the teams overall and at each column, most first, a
// tie at the printed tenth sharing its place; the teams come back in
// overall rank order, ties by roster id.
func PowerRanks(columns []apitypes.LeaguePowerColumn, teams []PowerTeam) []apitypes.LeaguePowerTeam {
	total := make([]float64, len(teams))
	for i, t := range teams {
		total[i] = t.Total
	}
	overall := powerPlaces(total)
	out := make([]apitypes.LeaguePowerTeam, len(teams))
	for i, t := range teams {
		out[i] = apitypes.LeaguePowerTeam{RosterId: t.RosterID, Rank: overall[i], Ranks: make([]int, len(columns))}
	}
	for j := range columns {
		values := make([]float64, len(teams))
		for i, t := range teams {
			values[i] = t.Columns[j]
		}
		for i, place := range powerPlaces(values) {
			out[i].Ranks[j] = place
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Rank != out[b].Rank {
			return out[a].Rank < out[b].Rank
		}
		return out[a].RosterId < out[b].RosterId
	})
	return out
}

// powerPlaces is each value's place, most first: one plus the values above
// it at the printed tenth, so a tie shares its place and the next skips.
func powerPlaces(values []float64) []int {
	out := make([]int, len(values))
	for i, v := range values {
		place := 1
		for _, w := range values {
			if roundTenth(w) > roundTenth(v) {
				place++
			}
		}
		out[i] = place
	}
	return out
}

// minPowerTeams is the fewest teams a power rank compares.
const minPowerTeams = 2

// Power is every team's power rank in the league, nil with fewer than two
// teams read.
func (a *advisor) Power() *apitypes.LeaguePower {
	if len(a.Snap.Teams) < minPowerTeams {
		return nil
	}
	league := a.tradeLeague()
	columns := league.PowerColumns()
	if len(columns) == 0 {
		return nil
	}
	teams := make([]PowerTeam, 0, len(a.Snap.Teams))
	for _, t := range a.Snap.Teams {
		teams = append(teams, league.Power(t.RosterID, a.squad(t, a.active(t), t.RosterID == a.Me).Players))
	}
	return &apitypes.LeaguePower{
		Basis:   fmt.Sprintf(powerWords, tradeWeeks(a.basis, a.weeks, a.horizon)),
		Columns: columns,
		Teams:   PowerRanks(columns, teams),
	}
}

// startSitOf is the member's start and sit record as the route answers it,
// nil with no graded week carrying the set lineup.
func startSitOf(weeks []leaguerecord.Week) *apitypes.LeagueStartSit {
	record, ok := leaguerecord.StartSitOf(weeks)
	if !ok {
		return nil
	}
	return &apitypes.LeagueStartSit{Weeks: record.Weeks, Matched: record.Matched, OursLessSet: record.OursLessSet, Basis: StartSitBasis}
}
