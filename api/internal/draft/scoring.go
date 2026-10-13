package draft

import "github.com/jhunthrop/commish/api/internal/jsmath"

// The float arithmetic below is the TypeScript's, operation for operation
// and in its order. Each product that feeds a sum is converted with
// float64() so the compiler cannot fuse the two into one rounding.

// RankWeight is exp(-index / temperature): rank 0 weighs 1.
func RankWeight(index int, temperature float64) float64 {
	return jsmath.Exp(-float64(index) / temperature)
}

// lateRoundOnly reports the two positions a board takes last.
func lateRoundOnly(p Position) bool { return p == K || p == DEF }

func dedicatedSlots(p Position, slots []SlotConfig) int {
	n := 0
	for _, c := range slots {
		if c.Slot == SlotType(p) {
			n += c.Count
		}
	}
	return n
}

// OpenStartingSlots is open dedicated slots for a position, FLEX and the
// bench excluded.
func OpenStartingSlots(p Position, roster []RosterSlot, slots []SlotConfig) int {
	return dedicatedSlots(p, slots) - filledIn(roster, SlotType(p))
}

// NeedOptions are the dials NeedMultiplier turns; the caller owns the values.
type NeedOptions struct {
	OpenSlotBoost float64
	FilledDamp    float64
	// SurplusDamp, when set, compounds FilledDamp once per body beyond capacity.
	SurplusDamp *float64
	// RosteredAtPosition is the team's true count at the position; nil
	// falls back to the label count.
	RosteredAtPosition *int
}

func extraSurplusBodies(p Position, roster []RosterSlot, slots []SlotConfig, rosteredAt *int) uint {
	configured := dedicatedSlots(p, slots)
	rostered := filledIn(roster, SlotType(p))
	if rosteredAt != nil {
		rostered = *rosteredAt
	}
	return uint(max(0, rostered-configured+1))
}

// NeedMultiplier warms a position per open dedicated starter and cools a
// filled one, compounding per surplus body when SurplusDamp is set.
func NeedMultiplier(p Position, roster []RosterSlot, slots []SlotConfig, o NeedOptions) float64 {
	open := OpenStartingSlots(p, roster, slots)
	warmed := 1 + float64(o.OpenSlotBoost*float64(open))
	if open > 0 {
		return warmed
	}
	if o.SurplusDamp == nil {
		if open == 0 {
			return o.FilledDamp
		}
		return warmed
	}
	return o.FilledDamp * jsmath.PowInt(*o.SurplusDamp, extraSurplusBodies(p, roster, slots, o.RosteredAtPosition))
}

// deferredLateRound is whether a kicker or defense waits: the policy sets
// a window, the league starts one, the team is not yet in its last rounds,
// and some other starter (FLEX included) is still open.
func deferredLateRound(p Position, roster []RosterSlot, slots []SlotConfig, roundsFromEnd *int) bool {
	if roundsFromEnd == nil || !lateRoundOnly(p) || dedicatedSlots(p, slots) == 0 {
		return false
	}
	if TotalRosterSlots(slots)-len(roster) <= *roundsFromEnd {
		return false
	}
	for _, c := range slots {
		if c.Slot == SlotBench || lateRoundOnly(Position(c.Slot)) {
			continue
		}
		if filledIn(roster, c.Slot) < c.Count {
			return true
		}
	}
	return false
}
