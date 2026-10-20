package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Squad is one roster as the waiver and trade searches read it: the
// players who count (injured reserve and taxi spots left out), the
// players the member holds (never dropped or given), and whether a
// roster spot is open, so an add needs no drop. Starters is the host's
// starters by id, which this week's lineup reads (Lineup).
type Squad struct {
	Players  []Candidate
	Held     map[string]bool
	Open     bool
	Starters []string
}

// Waiver is one candidate's best move: the drop with the largest gain
// that keeps the lineup full (an index into the squad, -1 for none) and
// the gain to the lineup in points over replacement a week.
type Waiver struct {
	Add    int
	Drop   int
	Gain   float64
	Starts bool
	// NoDrop says no drop he could take keeps the lineup full this week
	// and every slot filled, so there is no move to make.
	NoDrop bool
	// DropSlot and ForSlot are, for a drop this week's lineup starts, his
	// slot and the slot the add takes (indexes into Slots), -1 otherwise.
	DropSlot, ForSlot int
	// Drops is every player he could replace with the gain after each,
	// the move's own drop first, then by gain (Lane 66f's drop panel).
	// Empty when a roster spot is open or there is no move to make.
	Drops []Drop
	// Replaces is whom the move takes out of the rest-of-season lineup
	// the Gain is measured on (Lane 98, B14): the Beats cell's player.
	Replaces Replaced
}

// Replaced is the player a move takes out of the rest-of-season lineup:
// At an index into the squad when Known, or Empty when the add fills a
// slot the lineup left empty; neither when he starts no one's place.
type Replaced struct {
	At    int
	Known bool
	Empty bool
}

// Drop is one player a candidate could replace (an index into the
// squad), the lineup's gain after the swap, as Waiver.Gain, and whether
// this week's lineup starts him (the panel marks him; Lane 66u).
type Drop struct {
	At             int
	Gain           float64
	StartsThisWeek bool
}

// Waivers is §5.2's gain for every pool candidate, a week's over the
// weeks the order covers, positive gains first by gain, then the rest by
// points over replacement.
func Waivers(config []draft.SlotConfig, weeks int, squad Squad, pool []Candidate) []Waiver {
	w := waiverSearch{f: newFiller(Slots(config), weeks), squad: squad, mine: pointers(squad.Players),
		drops: newDropRule(config, squad, squad.Held), counts: positionCounts(squad.Players)}
	w.base, w.baseFilled = w.f.strength(w.mine)
	w.baseStarts = make([]bool, len(w.mine))
	for i := range w.mine {
		w.baseStarts[i] = w.f.started(i)
	}
	out := make([]Waiver, 0, len(pool))
	for a := range pool {
		out = append(out, w.bestDrop(a, &pool[a]))
	}
	sort.SliceStable(out, func(i, j int) bool {
		gi, gj := positive(out[i].Gain), positive(out[j].Gain)
		if gi != gj {
			return gi
		}
		if gi && out[i].Gain != out[j].Gain {
			return out[i].Gain > out[j].Gain
		}
		return across(&pool[out[i].Add], &pool[out[j].Add], false)
	})
	return out
}

// positive is a gain a page prints above zero.
func positive(gain float64) bool { return roundTenth(gain) > 0 }

type waiverSearch struct {
	f          *filler
	squad      Squad
	mine       []*Candidate
	base       float64
	baseFilled int
	// baseStarts is who the rest-of-season lineup starts, by squad index.
	baseStarts []bool
	drops      dropRule
	counts     map[draft.Position]int
}

// bestDrop is the move for one candidate: no drop when a spot is open,
// else, among the allowed drops that keep this week's lineup full and
// every rest-of-season slot filled, the largest rest-of-season gain (the
// trade finder's rule, recommend; coordinator's ruling, Lane 66u). The
// panel keeps every allowed drop, this week's starters marked.
func (w *waiverSearch) bestDrop(a int, c *Candidate) Waiver {
	if w.squad.Open {
		after := w.f.swap(w.mine, nil, c)
		strength, _ := w.f.strength(after)
		return Waiver{Add: a, Drop: -1, DropSlot: -1, ForSlot: -1, Gain: strength - w.base, Starts: w.f.started(len(after) - 1),
			Replaces: w.replaced(c, -1)}
	}
	in := []Candidate{*c}
	var drops []Drop
	var options []dropOption
	starts := map[int]bool{}
	for d := range w.mine {
		if !w.drops.allowed(d, c, w.counts) {
			continue
		}
		after := w.f.swap(w.mine, []int{d}, c)
		strength, filled := w.f.strength(after)
		starts[d] = w.f.started(len(after) - 1)
		gain := strength - w.base
		drops = append(drops, Drop{At: d, Gain: gain, StartsThisWeek: w.drops.startsThisWeek(d)})
		if filled < w.baseFilled {
			continue
		}
		options = append(options, dropOption{at: d, gain: gain, spot: noSpot})
	}
	best := Waiver{Add: a, Drop: -1, DropSlot: -1, ForSlot: -1, NoDrop: true}
	if o, ok := w.drops.recommend(options, nil, in); ok {
		best = Waiver{Add: a, Drop: o.at, DropSlot: -1, ForSlot: -1, Gain: o.gain, Starts: starts[o.at]}
		if o.spot.by >= 0 {
			best.DropSlot, best.ForSlot = w.drops.spotOf(o.at), o.spot.slot
		}
		best.Replaces = w.replaced(c, o.at)
	}
	best.Drops = w.ordered(drops, best.Drop)
	return best
}

// replaced is whom the add takes out of the rest-of-season lineup with
// the squad player at drop gone (-1 for none), from the same fill the
// Gain is measured on: the starter the after fill no longer starts (the
// drop himself when he started and no one else leaves), or the empty
// slot he fills; nothing when the add does not start.
func (w *waiverSearch) replaced(c *Candidate, drop int) Replaced {
	var out []int
	if drop >= 0 {
		out = []int{drop}
	}
	after := w.f.swap(w.mine, out, c)
	_, filled := w.f.strength(after)
	if !w.f.started(len(after) - 1) {
		return Replaced{}
	}
	at := 0
	for i := range w.mine {
		if i == drop {
			continue
		}
		if w.baseStarts[i] && !w.f.started(at) {
			return Replaced{At: i, Known: true}
		}
		at++
	}
	if drop >= 0 && w.baseStarts[drop] {
		return Replaced{At: drop, Known: true}
	}
	if filled > w.baseFilled {
		return Replaced{Empty: true}
	}
	return Replaced{}
}

// ordered is the drops with the move's own first, then the highest gain,
// then the player the order values least.
func (w *waiverSearch) ordered(drops []Drop, chosen int) []Drop {
	sort.SliceStable(drops, func(i, j int) bool {
		if (drops[i].At == chosen) != (drops[j].At == chosen) {
			return drops[i].At == chosen
		}
		if drops[i].Gain != drops[j].Gain {
			return drops[i].Gain > drops[j].Gain
		}
		return across(w.mine[drops[j].At], w.mine[drops[i].At], false)
	})
	return drops
}

// droppableFor is §5.2's position rule: a kicker or defense is dropped
// for a skill player only when the roster holds more of them than the
// league's own slots take.
func droppableFor(drop, add *Candidate, dedicated, counts map[draft.Position]int) bool {
	if skill(drop.Position) || !skill(add.Position) {
		return true
	}
	return counts[drop.Position] > dedicated[drop.Position]
}

// dedicatedCounts is the starting slots each position fills alone.
func dedicatedCounts(config []draft.SlotConfig) map[draft.Position]int {
	out := map[draft.Position]int{}
	for _, c := range config {
		if c.Slot != draft.SlotBench && len(c.EligiblePositions) == 1 {
			out[c.EligiblePositions[0]] += c.Count
		}
	}
	return out
}

func positionCounts(players []Candidate) map[draft.Position]int {
	out := map[draft.Position]int{}
	for _, p := range players {
		out[p.Position]++
	}
	return out
}
