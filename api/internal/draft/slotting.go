package draft

import (
	"fmt"
	"strings"
)

// eligibleSlots is every slot type that accepts p, in config order.
func eligibleSlots(p Position, slots []SlotConfig) []SlotType {
	var out []SlotType
	for _, c := range slots {
		if c.accepts(p) {
			out = append(out, c.Slot)
		}
	}
	return out
}

func filledIn(roster []RosterSlot, slot SlotType) int {
	n := 0
	for _, r := range roster {
		if r.Slot == slot {
			n++
		}
	}
	return n
}

// slotRefusal is validateRosterAdd's answer: "" when p may go in target.
func slotRefusal(slots []SlotConfig, roster []RosterSlot, p Position, target SlotType) string {
	for _, c := range slots {
		if c.Slot != target {
			continue
		}
		if !c.accepts(p) {
			return fmt.Sprintf("%s is not eligible for the %s slot.", p, target)
		}
		if filled := filledIn(roster, target); filled >= c.Count {
			return fmt.Sprintf("The %s slot is full (%d/%d filled).", target, filled, c.Count)
		}
		return ""
	}
	return fmt.Sprintf("The %s slot does not exist in this league.", target)
}

func lowestFreeIndex(roster []RosterSlot, slot SlotType) int {
	used := map[int]bool{}
	for _, r := range roster {
		if r.Slot == slot {
			used[r.SlotIndex] = true
		}
	}
	i := 0
	for used[i] {
		i++
	}
	return i
}

// Assignment is where a drafted player lands, or why he cannot.
type Assignment struct {
	OK        bool
	Slot      SlotType
	SlotIndex int
	Reason    string
}

// AssignSlot is the engine's one legality oracle: the first eligible slot
// in config order with room, so starters fill before FLEX and FLEX before
// the bench.
func AssignSlot(p Position, roster []RosterSlot, slots []SlotConfig) Assignment {
	eligible := eligibleSlots(p, slots)
	if len(eligible) == 0 {
		return Assignment{Reason: fmt.Sprintf("No roster slot in this league accepts a %s.", p)}
	}
	for _, slot := range eligible {
		if slotRefusal(slots, roster, p, slot) == "" {
			return Assignment{OK: true, Slot: slot, SlotIndex: lowestFreeIndex(roster, slot)}
		}
	}
	return Assignment{Reason: fmt.Sprintf("Your roster has no open slot for a %s.", p)}
}

func openCount(c SlotConfig, roster []RosterSlot) int {
	return c.Count - filledIn(roster, c.Slot)
}

// RestrictedPositions is the positions a roster can still take once they
// are fewer than the positions the league rosters: nil while a bench spot
// is open or everything still fits, empty for a full roster.
func RestrictedPositions(slots []SlotConfig, roster []RosterSlot) []Position {
	for _, c := range slots {
		if c.Slot == SlotBench && openCount(c, roster) > 0 {
			return nil
		}
	}
	open := []Position{}
	seen := map[Position]bool{}
	rostered := map[Position]bool{}
	for _, c := range slots {
		for _, p := range c.EligiblePositions {
			rostered[p] = true
		}
		if c.Slot == SlotBench || openCount(c, roster) <= 0 {
			continue
		}
		for _, p := range c.EligiblePositions {
			if !seen[p] {
				seen[p] = true
				open = append(open, p)
			}
		}
	}
	if len(open) == len(rostered) {
		return nil
	}
	return open
}

func positionLabel(p Position) string {
	if p == DEF {
		return "D/ST"
	}
	return string(p)
}

// MustPickLine is "Your next pick must be a K or a D/ST." for the
// positions a roster can still take.
func MustPickLine(positions []Position) string {
	words := make([]string, len(positions))
	for i, p := range positions {
		article := "a"
		if p == RB {
			article = "an"
		}
		words[i] = article + " " + positionLabel(p)
	}
	if len(words) == 1 {
		return "Your next pick must be " + words[0] + "."
	}
	return "Your next pick must be " + strings.Join(words[:len(words)-1], ", ") + " or " + words[len(words)-1] + "."
}
