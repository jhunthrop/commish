package boards

import (
	"fmt"
	"math"
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// projected is one projected player, for the replacement arithmetic.
type projected struct {
	id     string
	points float64
}

// sortByPoints is decide/replacement.ts's order: points, then id.
func sortByPoints(pool []projected) {
	sort.SliceStable(pool, func(i, j int) bool {
		if pool[i].points != pool[j].points {
			return pool[i].points > pool[j].points
		}
		return jsmath.Collate(pool[i].id, pool[j].id) < 0
	})
}

func poolsByPosition(players []Player) (map[draft.Position][]projected, error) {
	pools := map[draft.Position][]projected{}
	for _, p := range players {
		if p.Points == nil {
			continue
		}
		if math.IsNaN(*p.Points) || math.IsInf(*p.Points, 0) {
			return nil, fmt.Errorf("boards: the projection for %s is not a finite number", p.ID)
		}
		pools[p.Position] = append(pools[p.Position], projected{id: p.ID, points: *p.Points})
	}
	for _, pool := range pools {
		sortByPoints(pool)
	}
	return pools, nil
}

// startingDemand is how many starters the league fields at each position:
// dedicated slots are arithmetic, and each flexible slot goes to the
// eligible position with the best unclaimed player, narrowest slots
// first (decide/replacement.ts startingDemand).
func startingDemand(pools map[draft.Position][]projected, teams int, slots []draft.SlotConfig) map[draft.Position]int {
	demand := map[draft.Position]int{}
	var flexible []draft.SlotConfig
	for _, slot := range slots {
		if slot.Slot == draft.SlotBench {
			continue
		}
		for _, p := range slot.EligiblePositions {
			if _, ok := demand[p]; !ok {
				demand[p] = 0
			}
		}
		if len(slot.EligiblePositions) == 1 {
			demand[slot.EligiblePositions[0]] += slot.Count * teams
		} else {
			flexible = append(flexible, slot)
		}
	}
	sort.SliceStable(flexible, func(i, j int) bool {
		return len(flexible[i].EligiblePositions) < len(flexible[j].EligiblePositions)
	})
	for _, slot := range flexible {
		for unit := 0; unit < slot.Count*teams; unit++ {
			best, bestPoints, found := draft.Position(""), math.Inf(-1), false
			for _, p := range slot.EligiblePositions {
				pool := pools[p]
				if n := demand[p]; n < len(pool) && pool[n].points > bestPoints {
					best, bestPoints, found = p, pool[n].points, true
				}
			}
			// Every eligible pool is spent: the slot goes unfilled league
			// wide and raises nobody's demand.
			if !found {
				break
			}
			demand[best]++
		}
	}
	return demand
}

// valueOverReplacement is each projected player's points less the last
// starter's at his position, zero as the bar when the pool is shallower
// than the demand. A position the league never starts is left out, never
// valued at zero.
func valueOverReplacement(players []Player, teams int, slots []draft.SlotConfig) (map[string]float64, error) {
	if teams < 1 {
		return nil, fmt.Errorf("boards: a league needs a whole number of teams, got %d", teams)
	}
	pools, err := poolsByPosition(players)
	if err != nil {
		return nil, err
	}
	out := map[string]float64{}
	for position, count := range startingDemand(pools, teams, slots) {
		pool := pools[position]
		level := 0.0
		if count > 0 && count <= len(pool) {
			level = pool[count-1].points
		}
		for _, p := range pool {
			out[p.id] = p.points - level
		}
	}
	return out, nil
}

// positionRanks is each player's place at his position: by points over
// replacement where he has a value, then in pool order (ADP) for the rest.
func positionRanks(players []Player, values map[string]float64) map[string]int {
	type ranked struct {
		id    string
		value float64
		has   bool
		order int
	}
	byPosition := map[draft.Position][]ranked{}
	for i, p := range players {
		v, has := values[p.ID]
		byPosition[p.Position] = append(byPosition[p.Position], ranked{id: p.ID, value: v, has: has, order: i})
	}
	out := make(map[string]int, len(players))
	for _, list := range byPosition {
		sort.SliceStable(list, func(i, j int) bool {
			a, b := list[i], list[j]
			if a.has != b.has {
				return a.has
			}
			if a.has && a.value != b.value {
				return a.value > b.value
			}
			return a.order < b.order
		})
		for i, r := range list {
			out[r.id] = i + 1
		}
	}
	return out
}
