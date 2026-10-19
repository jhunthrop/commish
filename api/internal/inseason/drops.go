package inseason

import (
	"github.com/jhunthrop/commish/api/internal/draft"
)

// dropRule is who a roster may drop to make room, the one rule the
// waiver search and the trade finder read (Lane 66u): never a player the
// member holds, a kicker or defense only past the league's own slots
// (droppableFor), and a player this week's lineup starts (the Lineup
// screen's, weekOf) only when one of the players taken in takes his spot
// this week.
type dropRule struct {
	config    []draft.SlotConfig
	slots     []Slot
	squad     Squad
	held      map[string]bool
	dedicated map[draft.Position]int
	week      weekLineup
}

// newDropRule is the squad's rule; held is the players it never drops
// (nil for the other team's).
func newDropRule(config []draft.SlotConfig, squad Squad, held map[string]bool) dropRule {
	return dropRule{config: config, slots: Slots(config), squad: squad, held: held, dedicated: dedicatedCounts(config),
		week: weekOf(config, squad.Players, squad.Starters)}
}

// allowed is the position and hold rule for dropping roster[d] for add,
// with counts the roster's players a position once the move is made.
func (r dropRule) allowed(d int, add *Candidate, counts map[draft.Position]int) bool {
	p := &r.squad.Players[d]
	return !r.held[p.ID] && droppableFor(p, add, r.dedicated, counts)
}

// startsThisWeek reports whether this week's lineup starts roster[d].
func (r dropRule) startsThisWeek(d int) bool { return r.week.starts[d] }

// takesHisSpot is the player of in who takes the spot this week's lineup
// starts roster[d] in, once out and d are gone and in is taken in: an
// index into in, -1 when none does or he does not start this week.
func (r dropRule) takesHisSpot(d int, out []int, in []Candidate) int {
	if !r.week.starts[d] {
		return -1
	}
	gone := append(append(make([]int, 0, len(out)+1), out...), d)
	roster := Swapped(r.squad.Players, gone, in)
	after := weekOf(r.config, roster, r.squad.Starters)
	spot := r.week.slotOf[d]
	if spot < len(after.idle) && after.idle[spot] {
		return -1
	}
	position := r.squad.Players[d].Position
	first := len(roster) - len(in)
	for k := range in {
		at, ok := after.slotOf[first+k]
		if ok && r.slots[at].accepts(position) {
			return k
		}
	}
	return -1
}

// spotOf is the slot this week's lineup starts roster[d] in, -1 for none.
func (r dropRule) spotOf(d int) int {
	if at, ok := r.week.slotOf[d]; ok {
		return at
	}
	return -1
}
