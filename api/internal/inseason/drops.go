package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// dropRule is who a roster may drop to make room, the one rule the
// waiver search and the trade finder read (Lane 66u): never a player the
// member holds, a kicker or defense only past the league's own slots
// (droppableFor), and, for the drop a page recommends, a player this
// week's lineup starts (the Lineup screen's, weekOf) only when the move
// keeps that lineup full and starts one of the players taken in.
type dropRule struct {
	config []draft.SlotConfig
	slots  []Slot
	// weekFill is a week filler the moves share, its buffers kept between
	// them (the trade search reads thousands).
	weekFill  *filler
	squad     Squad
	held      map[string]bool
	dedicated map[draft.Position]int
	week      weekLineup
}

// newDropRule is the squad's rule; held is the players it never drops
// (nil for the other team's).
func newDropRule(config []draft.SlotConfig, squad Squad, held map[string]bool) dropRule {
	slots := Slots(config)
	weekFill := newFiller(slots, SeasonGames)
	weekFill.week = true
	return dropRule{config: config, slots: slots, weekFill: weekFill, squad: squad, held: held, dedicated: dedicatedCounts(config),
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

// spotIn is whether dropping roster[d] for a move keeps this week's
// lineup full (every slot it filled before is filled after, the chain of
// moves the fill makes included) and starts a player taken in, read from
// the week's lineup after the move, those players at first through
// first+n-1 of its roster: that player and the slot he actually takes, the
// one in d's own slot first; noSpot when either fails.
func (r dropRule) spotIn(after weekLineup, d, first, n int) takenSpot {
	for i, idle := range r.week.idle {
		if !idle && i < len(after.idle) && after.idle[i] {
			return noSpot
		}
	}
	spot, found := r.spotOf(d), noSpot
	for k := 0; k < n; k++ {
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

// withOne is out with d appended, in a new slice.
func withOne(out []int, d int) []int {
	return append(append(make([]int, 0, len(out)+1), out...), d)
}

// dropOption is a drop a page may recommend: who (an index into the
// roster), the rest-of-season gain with him gone, and, for one of this
// week's starters, who takes his place (noSpot otherwise).
type dropOption struct {
	at   int
	gain float64
	spot takenSpot
}

// recommend is the drop a page recommends for a move (out gone, in taken
// in) among cands, each with its rest-of-season gain (coordinator's
// ruling, Lane 66u): of the drops that keep this week's lineup full (a
// bench player, or a starter whose place a player taken in takes), the
// largest gain as a page prints it; between gains that print alike, the
// higher Proj this week's lineup keeps with him gone, a bench player
// before a starter when the Proj kept is the same, then the player our
// order values least. False when no drop keeps the lineup full.
func (r dropRule) recommend(cands []dropOption, out []int, in []Candidate) (dropOption, bool) {
	m := newMove(r, out, in)
	// Each gain is rounded once: the trade search ranks drops thousands of
	// times a read (Lane 287 fix round).
	type ranked struct {
		option  dropOption
		printed float64
	}
	keyed := make([]ranked, len(cands))
	for i, c := range cands {
		keyed[i] = ranked{c, roundTenth(c.gain)}
	}
	sort.SliceStable(keyed, func(i, j int) bool { return keyed[i].printed > keyed[j].printed })
	sorted := make([]dropOption, len(keyed))
	for i, k := range keyed {
		sorted[i] = k.option
	}
	for lo := 0; lo < len(sorted); {
		hi := lo
		for hi < len(sorted) && keyed[hi].printed == keyed[lo].printed {
			hi++
		}
		if best, ok := m.bestOfTier(sorted[lo:hi]); ok {
			return best, true
		}
		lo = hi
	}
	return dropOption{}, false
}

// move is one move's week, read once: the lineup after it with nobody
// dropped is set only when a player the move gives starts this week (else
// no bench player can start after it, and a bench drop leaves the lineup
// as it is).
type move struct {
	r          dropRule
	out        []int
	in         []Candidate
	outStarts  bool
	after      weekLineup
	afterKnown bool
	starts     []bool
}

func newMove(r dropRule, out []int, in []Candidate) *move {
	m := &move{r: r, out: out, in: in}
	for _, o := range out {
		m.outStarts = m.outStarts || r.week.starts[o]
	}
	return m
}

// lineupAfter is this week's lineup after the move with nobody dropped.
func (m *move) lineupAfter() weekLineup {
	if !m.afterKnown {
		m.after, m.afterKnown = weekOf(m.r.config, Swapped(m.r.squad.Players, m.out, m.in), m.r.squad.Starters), true
	}
	return m.after
}

// startsAfter reports whether the lineup after the move starts roster[d].
func (m *move) startsAfter(d int) bool {
	if !m.r.week.starts[d] && !m.outStarts {
		return false
	}
	i := d
	for _, o := range m.out {
		if o < d {
			i--
		}
	}
	return m.startsAfterMove()[i]
}

// startsAfterMove is who the lineup after the move starts, by its roster
// index. With nobody locked the Lineup's fill is the week filler's alone
// (no host spot to keep), so it is read from a filler, as the trade
// search's thousands of moves need; with a locked player, from the Lineup.
func (m *move) startsAfterMove() []bool {
	if m.starts != nil {
		return m.starts
	}
	roster := Swapped(m.r.squad.Players, m.out, m.in)
	for _, c := range roster {
		if c.Locked {
			m.starts = m.lineupAfter().starts
			return m.starts
		}
	}
	f := m.r.weekFill
	f.pool = f.pool[:0]
	f.taken = f.taken[:0]
	for i := range roster {
		f.pool = append(f.pool, &roster[i])
		f.taken = append(f.taken, roster[i].Tier != Available)
	}
	m.starts = make([]bool, len(roster))
	for _, p := range f.fill(f.open, f.pool, f.taken) {
		if p >= 0 {
			m.starts[p] = true
		}
	}
	return m.starts
}

// bestOfTier is recommend's choice among drops whose gains print alike.
// A player the lineup after the move does not start leaves it as it is,
// so its Proj is the most any drop keeps: the bench players among them
// first, then the starters whose place is taken; only when none qualifies
// is the Lineup set again without each player it starts.
func (m *move) bestOfTier(tier []dropOption) (dropOption, bool) {
	r := m.r
	least := func(list []dropOption) (dropOption, bool) {
		var best dropOption
		found := false
		for _, o := range list {
			if !found || across(&r.squad.Players[best.at], &r.squad.Players[o.at], false) {
				best, found = o, true
			}
		}
		return best, found
	}
	var bench, sitting, starting []dropOption
	for _, o := range tier {
		switch {
		case m.startsAfter(o.at):
			starting = append(starting, o)
		case !r.week.starts[o.at]:
			bench = append(bench, o)
		default:
			sitting = append(sitting, o)
		}
	}
	if best, ok := least(bench); ok {
		return best, true
	}
	// A starter the lineup after the move benches: his place is taken when
	// it stays full with a player brought in starting.
	starters := sitting[:0]
	for _, o := range sitting {
		after := m.lineupAfter()
		if o.spot = r.spotIn(after, o.at, len(after.starts)-len(m.in), len(m.in)); o.spot.by >= 0 {
			starters = append(starters, o)
		}
	}
	if best, ok := least(starters); ok {
		return best, true
	}
	var best dropOption
	bestProj, found := 0.0, false
	for _, o := range starting {
		roster := Swapped(r.squad.Players, withOne(m.out, o.at), m.in)
		without := weekOf(r.config, roster, r.squad.Starters)
		if r.week.starts[o.at] {
			if o.spot = r.spotIn(without, o.at, len(roster)-len(m.in), len(m.in)); o.spot.by < 0 {
				continue
			}
		} else if emptier(m.lineupAfter(), without) {
			continue
		}
		if !found || without.proj > bestProj || (without.proj == bestProj && across(&r.squad.Players[best.at], &r.squad.Players[o.at], false)) {
			best, bestProj, found = o, without.proj, true
		}
	}
	return best, found
}

// emptier reports whether without leaves a slot empty that after fills.
func emptier(after, without weekLineup) bool {
	for i, idle := range after.idle {
		if !idle && i < len(without.idle) && without.idle[i] {
			return true
		}
	}
	return false
}
