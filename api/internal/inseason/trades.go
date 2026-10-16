package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// TradesPerTeam is how many trades a team's list shows, best for the
// member first.
const TradesPerTeam = 10

// CloseCall is the gain a week under which a trade is a close call for
// the other side (§6.2).
const CloseCall = 0.5

// Trade is one trade both lineups gain from: who the member gives and
// gets (indexes into each squad), who the member drops to make room
// (Drop, -1 for none) and each side's gain in points over replacement a
// week, after any drop.
type Trade struct {
	Give      []int
	Get       []int
	Drop      int
	MyGain    float64
	TheirGain float64
}

// tradeSide is one squad as the search reads it: its players, its
// strength before the trade, the slots it fills, the players it may
// trade, whether its holds count (the member's own), and the starting
// slots each position fills alone (the drop's kicker and defense rule).
type tradeSide struct {
	squad     Squad
	players   []*Candidate
	base      float64
	filled    int
	baseFill  []bool
	tradeable []int
	own       bool
	dedicated map[draft.Position]int
}

func newSide(f *filler, squad Squad, own bool, dedicated map[draft.Position]int) tradeSide {
	s := tradeSide{squad: squad, players: pointers(squad.Players), own: own, dedicated: dedicated}
	s.base, s.filled = f.strength(s.players)
	s.baseFill = make([]bool, len(f.out))
	for i, p := range f.out {
		s.baseFill[i] = p >= 0
	}
	for i, c := range squad.Players {
		if skill(c.Position) && !c.InjuredReserve && !(own && squad.Held[c.ID]) {
			s.tradeable = append(s.tradeable, i)
		}
	}
	return s
}

// Change is one side's trade: its gain in points over replacement a
// week (below zero a loss), the player it drops to make room (-1 for
// none), whether it still fills every slot it filled (Open the first it
// leaves empty, an index into Slots, -1 for none), and whether it has
// room for what it takes in: an open spot, or a player to drop.
type Change struct {
	Gain  float64
	Drop  int
	Fills bool
	Open  int
	Room  bool
}

// stands is a side the finder may keep the trade for.
func (c Change) stands() bool { return c.Fills && c.Room }

// change is the side's change from losing out and taking in. The drop
// is looked for only when the side takes in more than it gives with no
// open spot and, unless always, only when it gains: a drop never raises
// a lineup, so the finder refuses a trade with no gain as it is.
func (s tradeSide) change(f *filler, out []int, in []*Candidate, always bool) Change {
	strength, filled := f.strength(f.swap(s.players, out, in...))
	c := Change{Gain: strength - s.base, Drop: -1, Fills: filled >= s.filled, Open: -1, Room: true}
	if !c.Fills {
		c.Open = s.emptied(f.out)
		return c
	}
	if len(in) <= len(out) || s.squad.Open || (!always && !positive(c.Gain)) {
		return c
	}
	c.Drop = s.withDrop(f, out, in)
	c.Room = c.Drop >= 0
	return c
}

// emptied is the first slot the side filled before that fill leaves
// empty, -1 for none.
func (s tradeSide) emptied(fill []int) int {
	for i, p := range fill {
		if p < 0 && s.baseFill[i] {
			return i
		}
	}
	return -1
}

// withDrop is §5.2's drop for a roster a trade grows past its spots:
// the player it costs least to lose, never one it gives, never a starter
// after the trade, never held, never a kicker or defense without a
// spare; -1 for nobody. A player the fill does not start changes no
// slot, so every allowed drop leaves the lineup as it is and the one to
// drop is the last of them on our order.
func (s tradeSide) withDrop(f *filler, out []int, in []*Candidate) int {
	f.strength(f.swap(s.players, out, in...))
	counts := s.countsAfter(out, in)
	best, at := -1, 0
	for d, p := range s.players {
		if contains(out, d) {
			continue
		}
		started := f.started(at)
		at++
		if started || (s.own && s.squad.Held[p.ID]) || !droppableFor(p, in[0], s.dedicated, counts) {
			continue
		}
		if best < 0 || across(s.players[best], p, false) {
			best = d
		}
	}
	return best
}

// countsAfter is the side's players a position after losing out and
// taking in.
func (s tradeSide) countsAfter(out []int, in []*Candidate) map[draft.Position]int {
	counts := map[draft.Position]int{}
	for i, p := range s.players {
		if !contains(out, i) {
			counts[p.Position]++
		}
	}
	for _, p := range in {
		counts[p.Position]++
	}
	return counts
}

func (s tradeSide) at(list []int, buf []*Candidate) []*Candidate {
	buf = buf[:0]
	for _, p := range list {
		buf = append(buf, s.players[p])
	}
	return buf
}

// CloseForThem is a trade whose gain to the other side, as a page prints
// it, is under CloseCall.
func (t Trade) CloseForThem() bool { return roundTenth(t.TheirGain) < CloseCall }

// orderTrades puts the trades the other side gains from first and the
// close calls for them after, each group by the member's gain, then by
// theirs: the first trade a page shows is one the other team can accept.
func orderTrades(trades []Trade) {
	sort.SliceStable(trades, func(i, j int) bool {
		a, b := trades[i], trades[j]
		if a.CloseForThem() != b.CloseForThem() {
			return !a.CloseForThem()
		}
		if a.MyGain != b.MyGain {
			return a.MyGain > b.MyGain
		}
		return a.TheirGain > b.TheirGain
	})
}

// tradeSearch is the two sides of one team's trades, with the buffer the
// players taken in are read into.
type tradeSearch struct {
	f      *filler
	me     tradeSide
	them   tradeSide
	buffer []*Candidate
}

func newSearch(config []draft.SlotConfig, weeks int, mine, theirs Squad) *tradeSearch {
	f := newFiller(Slots(config), weeks)
	dedicated := dedicatedCounts(config)
	me := newSide(f, mine, true, dedicated)
	return &tradeSearch{f: f, me: me, them: newSide(f, theirs, false, dedicated)}
}

// mine and theirs are each side's change from the member giving give and
// getting get: the one reckoning the finder and the builder share.
func (t *tradeSearch) mine(give, get []int, always bool) Change {
	t.buffer = t.them.at(get, t.buffer)
	return t.me.change(t.f, give, t.buffer, always)
}

func (t *tradeSearch) theirs(give, get []int, always bool) Change {
	t.buffer = t.me.at(give, t.buffer)
	return t.them.change(t.f, get, t.buffer, always)
}

// Trades is §6.2's search between the member's squad and one other team's:
// exact over every one-for-one and two-for-one pair both ways at the
// skill positions, a trade kept when both lineups gain and both still
// fill every slot. focus, when set, keeps only trades holding that
// player (either side's id). The best limit trades in orderTrades' order.
// Gains are a week's over the weeks the order covers.
func Trades(config []draft.SlotConfig, weeks int, mine, theirs Squad, focus string, limit int) []Trade {
	t := newSearch(config, weeks, mine, theirs)
	me, them := t.me, t.them
	var out []Trade
	try := func(give, get []int) {
		if focus != "" && !holds(me, give, focus) && !holds(them, get, focus) {
			return
		}
		my := t.mine(give, get, false)
		if !my.stands() || !positive(my.Gain) {
			return
		}
		their := t.theirs(give, get, false)
		if !their.stands() || !positive(their.Gain) {
			return
		}
		out = append(out, Trade{Give: give, Get: get, Drop: my.Drop, MyGain: my.Gain, TheirGain: their.Gain})
	}
	for _, g := range me.tradeable {
		for _, h := range them.tradeable {
			try([]int{g}, []int{h})
		}
	}
	for _, pair := range pairs(me.tradeable) {
		for _, h := range them.tradeable {
			try(pair, []int{h})
		}
	}
	for _, g := range me.tradeable {
		for _, pair := range pairs(them.tradeable) {
			try([]int{g}, pair)
		}
	}
	orderTrades(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// Checked is one trade the member built, on the finder's reckoning: its
// figures as the finder would list them, and each side's change.
type Checked struct {
	Trade
	Mine   Change
	Theirs Change
}

// Check is the builder's trade (Lane 61): the member gives give and gets
// get (indexes into each squad), answered whatever its gains, with the
// drop a full roster makes for more in than out. The gains are the
// finder's own, so a trade the finder lists checks to its numbers.
func Check(config []draft.SlotConfig, weeks int, mine, theirs Squad, give, get []int) Checked {
	t := newSearch(config, weeks, mine, theirs)
	my, their := t.mine(give, get, true), t.theirs(give, get, true)
	return Checked{Trade: Trade{Give: give, Get: get, Drop: my.Drop, MyGain: my.Gain, TheirGain: their.Gain}, Mine: my, Theirs: their}
}

func holds(s tradeSide, at []int, id string) bool {
	for _, p := range at {
		if s.squad.Players[p].ID == id {
			return true
		}
	}
	return false
}

// pairs is every two of at, in order.
func pairs(at []int) [][]int {
	var out [][]int
	for i := range at {
		for j := i + 1; j < len(at); j++ {
			out = append(out, []int{at[i], at[j]})
		}
	}
	return out
}
