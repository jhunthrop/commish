package sim

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// RosteredPlayer is one player on a finished roster.
type RosteredPlayer struct {
	PlayerID string         `json:"playerId"`
	Position draft.Position `json:"position"`
}

// Lineup is the greedy starting assignment: who started, and how many
// starting slot instances the league defines.
type Lineup struct {
	StarterIDs []string
	// StarterSlots is the slot each starter fills, parallel to StarterIDs.
	StarterSlots       []draft.SlotType
	StartingSlotsTotal int
}

// AssignStartingLineup fills starting slots most-restrictive first, each
// with the best remaining eligible player by points (ties by id). Optimal
// for nested eligibility (QB in SUPERFLEX in BENCH); a player absent from
// points scores 0 and is never invented a score.
func AssignStartingLineup(roster []RosteredPlayer, slots []draft.SlotConfig, points map[string]float64) Lineup {
	remaining := append([]RosteredPlayer(nil), roster...)
	sort.SliceStable(remaining, func(i, j int) bool {
		pi, pj := points[remaining[i].PlayerID], points[remaining[j].PlayerID]
		if pi != pj {
			return pi > pj
		}
		return jsmath.Collate(remaining[i].PlayerID, remaining[j].PlayerID) < 0
	})
	starting := make([]draft.SlotConfig, 0, len(slots))
	for _, c := range slots {
		if c.Slot != draft.SlotBench {
			starting = append(starting, c)
		}
	}
	sort.SliceStable(starting, func(i, j int) bool {
		return len(starting[i].EligiblePositions) < len(starting[j].EligiblePositions)
	})
	taken := map[string]bool{}
	out := Lineup{StarterIDs: []string{}}
	for _, c := range starting {
		out.StartingSlotsTotal += c.Count
		for unit := 0; unit < c.Count; unit++ {
			for _, p := range remaining {
				if !taken[p.PlayerID] && accepts(c, p.Position) {
					taken[p.PlayerID] = true
					out.StarterIDs = append(out.StarterIDs, p.PlayerID)
					out.StarterSlots = append(out.StarterSlots, c.Slot)
					break
				}
			}
		}
	}
	return out
}

func accepts(c draft.SlotConfig, p draft.Position) bool {
	for _, e := range c.EligiblePositions {
		if e == p {
			return true
		}
	}
	return false
}

// StartingPoints is the lineup's total, summed in starter order.
func StartingPoints(l Lineup, points map[string]float64) float64 {
	total := 0.0
	for _, id := range l.StarterIDs {
		total += points[id]
	}
	return total
}
