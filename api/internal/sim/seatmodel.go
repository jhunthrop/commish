package sim

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// SeatModelConfig is when a seat's read leaves the neutral prior.
type SeatModelConfig struct {
	// MinPicks is the fewest observed picks before a seat is read.
	MinPicks int
	// MinLogLikelihoodEdge is how far the best brain must beat the neutral one.
	MinLogLikelihoodEdge float64
	// OutsideWindowLikelihood is charged for a pick no brain would reach.
	OutsideWindowLikelihood float64
}

// DefaultSeatModel is two picks and an edge of ln 1.5.
func DefaultSeatModel() SeatModelConfig {
	return SeatModelConfig{MinPicks: 2, MinLogLikelihoodEdge: jsmath.Log(1.5), OutsideWindowLikelihood: 0.02}
}

func picksInOrder(s draft.State) []draft.Pick {
	ordered := append([]draft.Pick(nil), s.Picks...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].PickNumber < ordered[j].PickNumber })
	return ordered
}

// shadowBefore is the room as it stood the instant before pickNumber,
// rebuilt from the pick log with no queues and no owed picks.
func shadowBefore(s draft.State, ordered []draft.Pick, pickNumber int) draft.State {
	before := make([]draft.Pick, 0, len(ordered))
	rosters := map[string][]draft.RosterSlot{}
	for _, p := range ordered {
		if p.PickNumber >= pickNumber {
			continue
		}
		before = append(before, p)
		rosters[p.TeamID] = append(rosters[p.TeamID], draft.RosterSlot{Slot: p.Slot, SlotIndex: p.SlotIndex, PlayerID: p.PlayerID})
	}
	shadow := s
	shadow.Picks, shadow.Rosters = before, rosters
	shadow.Queues, shadow.OwedPicks = map[string][]string{}, map[string][]int{}
	shadow.PickNumber = pickNumber
	return shadow
}

// pickLogLikelihood is ln P(observed pick | archetype) under the room's
// need shape with the policy's exclusions set aside.
func pickLogLikelihood(shadow draft.State, teamID, playerID string, a bots.Archetype, strategy bots.Strategy, cfg SeatModelConfig) float64 {
	weights := bots.CandidateWeights(shadow, teamID, a, strategy, bots.WeightOptions{Observe: true})
	total := 0.0
	own, found := 0.0, false
	for _, w := range weights {
		total += w.Weight
		if !found && w.PlayerID == playerID {
			own, found = w.Weight, true
		}
	}
	if !found || total <= 0 {
		return jsmath.Log(cfg.OutsideWindowLikelihood)
	}
	return jsmath.Log(own / total)
}

// InferSeatDriver reads one seat from its own picks: autopick if its last
// pick was the clock's, the neutral prior below the thresholds, else the
// brain under which its picks were most likely.
func InferSeatDriver(s draft.State, teamID string, strategy bots.Strategy, cfg SeatModelConfig) Driver {
	ordered := picksInOrder(s)
	var own []draft.Pick
	for _, p := range ordered {
		if p.TeamID == teamID {
			own = append(own, p)
		}
	}
	observed := len(own)
	if observed > 0 && own[observed-1].Auto {
		return Driver{Kind: DriveAutopick, PicksObserved: observed}
	}
	prior := Driver{Kind: DriveArchetype, Archetype: bots.Neutral(), Basis: Prior, PicksObserved: observed}
	if observed < cfg.MinPicks {
		return prior
	}
	shadows := make([]draft.State, len(own))
	for i, p := range own {
		shadows[i] = shadowBefore(s, ordered, p.PickNumber)
	}
	deck := bots.Archetypes()
	scores := make([]float64, len(deck))
	for i, a := range deck {
		sum := 0.0
		for j, p := range own {
			sum += pickLogLikelihood(shadows[j], teamID, p.PlayerID, a, strategy, cfg)
		}
		scores[i] = sum
	}
	neutral := 0
	best := 0
	for i := range deck {
		if scores[i] > scores[best] {
			best = i
		}
	}
	if best != neutral && scores[best]-scores[neutral] >= cfg.MinLogLikelihoodEdge {
		return Driver{Kind: DriveArchetype, Archetype: deck[best], Basis: Inferred, PicksObserved: observed}
	}
	return prior
}

// InferSeatDrivers reads every seat in the draft order.
func InferSeatDrivers(s draft.State, strategy bots.Strategy, cfg SeatModelConfig) Drivers {
	out := make(Drivers, len(s.DraftOrder))
	for _, team := range s.DraftOrder {
		out[team] = InferSeatDriver(s, team, strategy, cfg)
	}
	return out
}
