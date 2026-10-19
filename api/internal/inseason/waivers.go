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

// Waiver is one candidate's best move: the drop it costs least to lose
// (an index into the squad, -1 for none) and the gain to the lineup in
// points over replacement a week.
type Waiver struct {
	Add    int
	Drop   int
	Gain   float64
	Starts bool
	// NoDrop says every player he could replace is held or a starter he
	// would not displace, so there is no move to make.
	NoDrop bool
	// Drops is every player he could replace with the gain after each,
	// the move's own drop first, then by gain (Lane 66f's drop panel).
	// Empty when a roster spot is open or there is no move to make.
	Drops []Drop
}

// Drop is one player a candidate could replace (an index into the
// squad) and the lineup's gain after the swap, as Waiver.Gain.
type Drop struct {
	At   int
	Gain float64
}

// Waivers is §5.2's gain for every pool candidate, a week's over the
// weeks the order covers, positive gains first by gain, then the rest by
// points over replacement.
func Waivers(config []draft.SlotConfig, weeks int, squad Squad, pool []Candidate) []Waiver {
	w := waiverSearch{f: newFiller(Slots(config), weeks), squad: squad, mine: pointers(squad.Players),
		drops: newDropRule(config, squad, squad.Held), counts: positionCounts(squad.Players)}
	w.base, _ = w.f.strength(w.mine)
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
	baseStarts []bool
	drops      dropRule
	counts     map[draft.Position]int
}

// bestDrop is the move for one candidate: no drop when a spot is open,
// else the allowed drop whose loss costs least.
func (w *waiverSearch) bestDrop(a int, c *Candidate) Waiver {
	if w.squad.Open {
		after := w.f.swap(w.mine, nil, c)
		strength, _ := w.f.strength(after)
		return Waiver{Add: a, Drop: -1, Gain: strength - w.base, Starts: w.f.started(len(after) - 1)}
	}
	best := Waiver{Add: a, Drop: -1, NoDrop: true}
	var drops []Drop
	for d, p := range w.mine {
		if !w.drops.allowed(d, c, w.counts) {
			continue
		}
		// A player this week's lineup starts goes only for an add who
		// takes his spot this week (Lane 66u, the trade finder's rule).
		if w.drops.startsThisWeek(d) && w.drops.takesHisSpot(d, nil, []Candidate{*c}) < 0 {
			continue
		}
		after := w.f.swap(w.mine, []int{d}, c)
		strength, _ := w.f.strength(after)
		starts := w.f.started(len(after) - 1)
		// A starter goes only to make room for the candidate himself.
		if w.baseStarts[d] && !starts {
			continue
		}
		gain := strength - w.base
		drops = append(drops, Drop{At: d, Gain: gain})
		if best.NoDrop || gain > best.Gain || (gain == best.Gain && across(w.mine[best.Drop], p, false)) {
			best = Waiver{Add: a, Drop: d, Gain: gain, Starts: starts}
		}
	}
	best.Drops = w.ordered(drops, best.Drop)
	return best
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
