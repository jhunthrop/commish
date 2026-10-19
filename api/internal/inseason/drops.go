package inseason

import (
	"github.com/jhunthrop/commish/api/internal/draft"
)

// dropRule is who a roster may drop to make room, the one rule the
// waiver search and the trade finder read (Lane 66u): never a player the
// member holds, a kicker or defense only past the league's own slots
// (droppableFor), and, for the drop a page recommends, a player this
// week's lineup starts (the Lineup screen's, weekOf) only when the move
// keeps that lineup full and starts one of the players taken in.
type dropRule struct {
	config    []draft.SlotConfig
	squad     Squad
	held      map[string]bool
	dedicated map[draft.Position]int
	week      weekLineup
}

// newDropRule is the squad's rule; held is the players it never drops
// (nil for the other team's).
func newDropRule(config []draft.SlotConfig, squad Squad, held map[string]bool) dropRule {
	return dropRule{config: config, squad: squad, held: held, dedicated: dedicatedCounts(config),
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

// spotOf is the slot this week's lineup starts roster[d] in, -1 for none.
func (r dropRule) spotOf(d int) int {
	if at, ok := r.week.slotOf[d]; ok {
		return at
	}
	return -1
}

// takenSpot is who takes a dropped starter's place: the player of in who
// starts (an index into in) and the slot he starts in (an index into
// Slots).
type takenSpot struct{ by, slot int }

// noSpot is a move that does not take his place.
var noSpot = takenSpot{by: -1, slot: -1}

// takesHisSpot is whether dropping roster[d], once out are gone and in
// taken in, keeps this week's lineup full (every slot it filled before
// is filled after, the chain of moves the fill makes included) and starts
// a player of in: that player and the slot he actually takes, the one in
// d's own slot first; noSpot when either fails.
func (r dropRule) takesHisSpot(d int, out []int, in []Candidate) takenSpot {
	gone := append(append(make([]int, 0, len(out)+1), out...), d)
	roster := Swapped(r.squad.Players, gone, in)
	after := weekOf(r.config, roster, r.squad.Starters)
	for i, idle := range r.week.idle {
		if !idle && i < len(after.idle) && after.idle[i] {
			return noSpot
		}
	}
	spot, first, found := r.spotOf(d), len(roster)-len(in), noSpot
	for k := range in {
		at, ok := after.slotOf[first+k]
		if !ok || !after.starts[first+k] {
			continue
		}
		if at == spot {
			return takenSpot{by: k, slot: at}
		}
		if found.by < 0 {
			found = takenSpot{by: k, slot: at}
		}
	}
	return found
}
