package draft

import "github.com/jhunthrop/commish/api/internal/jsmath"

// Roster need from the league's own shape (roster-need.ts): a candidate
// who would start is warm per open starting slot he could fill; one who
// would sit is a bench body; a position is capped at its starters plus
// its bench allowance; the backup at a single-starter position waits for
// the starters.

// sharedClaimantOrder is which position a shared slot is in practice: the
// eligible position that scores the most over a season.
func sharedClaimantOrder() [6]Position { return [6]Position{QB, RB, WR, TE, K, DEF} }

func rosteredPositions(slots []SlotConfig) []Position {
	var out []Position
	seen := map[Position]bool{}
	for _, c := range slots {
		for _, p := range c.EligiblePositions {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

func isSharedSlot(c SlotConfig) bool {
	return c.Slot != SlotBench && len(c.EligiblePositions) > 1
}

func sharedSlotsEligible(p Position, slots []SlotConfig) int {
	n := 0
	for _, c := range slots {
		if isSharedSlot(c) && c.accepts(p) {
			n += c.Count
		}
	}
	return n
}

func benchSlots(slots []SlotConfig) int {
	n := 0
	for _, c := range slots {
		if c.Slot == SlotBench {
			n += c.Count
		}
	}
	return n
}

func startingDemand(p Position, slots []SlotConfig) int {
	return dedicatedSlots(p, slots) + sharedSlotsEligible(p, slots)
}

func claimsSharedSlot(p Position, c SlotConfig) bool {
	for _, candidate := range sharedClaimantOrder() {
		if c.accepts(candidate) {
			return candidate == p
		}
	}
	return false
}

func sharedSlotsClaimed(p Position, slots []SlotConfig) int {
	n := 0
	for _, c := range slots {
		if isSharedSlot(c) && claimsSharedSlot(p, c) {
			n += c.Count
		}
	}
	return n
}

// IsSingleStarterPosition is a position with exactly one startable slot,
// the shared slots it claims counted, K and DEF excepted.
func IsSingleStarterPosition(p Position, slots []SlotConfig) bool {
	return !lateRoundOnly(p) && dedicatedSlots(p, slots)+sharedSlotsClaimed(p, slots) == 1
}

// PositionCeiling is the most players a roster should hold at p.
func PositionCeiling(p Position, slots []SlotConfig, policy CeilingPolicy) int {
	dedicated := dedicatedSlots(p, slots)
	shared := sharedSlotsEligible(p, slots)
	switch {
	case dedicated == 0 && shared == 0:
		return 0
	case lateRoundOnly(p):
		return dedicated
	case IsSingleStarterPosition(p, slots):
		return dedicated + policy.BackupsAtSingleStarterPosition
	}
	positions := rosteredPositions(slots)
	singleStarters, demand := 0, 0
	for _, candidate := range positions {
		if IsSingleStarterPosition(candidate, slots) {
			singleStarters++
		} else if !lateRoundOnly(candidate) {
			demand += startingDemand(candidate, slots)
		}
	}
	remaining := max(0, benchSlots(slots)-singleStarters*policy.BackupsAtSingleStarterPosition)
	share := float64(remaining) * (float64(startingDemand(p, slots)) / float64(demand))
	return dedicated + shared + int(jsmath.Round(share))
}

// openStartingSlotsEligible is open non-bench slots p could start in.
func openStartingSlotsEligible(p Position, roster []RosterSlot, slots []SlotConfig) int {
	n := 0
	for _, c := range slots {
		if c.Slot != SlotBench && c.accepts(p) {
			n += max(0, openCount(c, roster))
		}
	}
	return n
}

// anyStarterOpen is whether a starting slot other than K or DEF is unfilled.
func anyStarterOpen(roster []RosterSlot, slots []SlotConfig) bool {
	for _, c := range slots {
		if c.Slot != SlotBench && !lateRoundOnly(Position(c.Slot)) && openCount(c, roster) > 0 {
			return true
		}
	}
	return false
}

// countByPosition counts roster spots by the pooled player's position.
func countByPosition(spots []RosterSlot, pool Pool, benchOnly bool) map[Position]int {
	counts := map[Position]int{}
	for _, spot := range spots {
		if benchOnly && spot.Slot != SlotBench {
			continue
		}
		if p, ok := pool.PositionOf(spot.PlayerID); ok {
			counts[p]++
		}
	}
	return counts
}

// CandidateRole is what one legal candidate is to a roster.
type CandidateRole struct {
	Starts            bool
	OpenStartingSlots int
	BenchBodies       int
	Capped            bool
	WaitsForStarters  bool
}

// RoleReader classifies candidates for one roster: the clock, the bots and
// the advisor read the same rule.
type RoleReader func(p Position, landsIn SlotType) CandidateRole

// NewRoleReader builds the reader once per roster. Everything a role
// reads per position is computed here once, so a scan of the whole board
// asks the slot config six times, not once per player.
func NewRoleReader(roster []RosterSlot, slots []SlotConfig, pool Pool, policy CeilingPolicy) RoleReader {
	rostered := countByPosition(roster, pool, false)
	bench := countByPosition(roster, pool, true)
	starterOpen := anyStarterOpen(roster, slots)
	type perPosition struct {
		capped       bool
		openStarting int
	}
	known := map[Position]perPosition{}
	for _, p := range sharedClaimantOrder() {
		known[p] = perPosition{
			capped:       rostered[p]+1 > PositionCeiling(p, slots, policy),
			openStarting: openStartingSlotsEligible(p, roster, slots),
		}
	}
	return func(p Position, landsIn SlotType) CandidateRole {
		starts := landsIn != SlotBench
		facts := known[p]
		role := CandidateRole{
			Starts:           starts,
			BenchBodies:      bench[p],
			Capped:           facts.capped,
			WaitsForStarters: !starts && starterOpen,
		}
		if starts {
			role.OpenStartingSlots = facts.openStarting
		}
		return role
	}
}
