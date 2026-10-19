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
// week, after any drop. A drop this week's lineup starts names his spot
// (DropSlot, an index into Slots), the player of Get who starts with the
// lineup kept full (DropFor, an index into Get) and the slot that player
// takes (ForSlot); all -1 for a bench drop or none.
type Trade struct {
	Give      []int
	Get       []int
	Drop      int
	DropFor   int
	DropSlot  int
	ForSlot   int
	MyGain    float64
	TheirGain float64
}

// tradeSide is one squad as the search reads it: its players, its
// strength before the trade, the slots it fills, the players it may
// trade, whether its holds count (the member's own), and who it may drop
// (the rule Waivers reads too).
type tradeSide struct {
	squad     Squad
	players   []*Candidate
	base      float64
	filled    int
	baseFill  []bool
	tradeable []int
	own       bool
	drops     dropRule
}

func newSide(f *filler, config []draft.SlotConfig, squad Squad, own bool) tradeSide {
	var held map[string]bool
	if own {
		held = squad.Held
	}
	s := tradeSide{squad: squad, players: pointers(squad.Players), own: own, drops: newDropRule(config, squad, held)}
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
// room for what it takes in: an open spot, or a player to drop. A drop
// this week's lineup starts names his spot (DropSlot), who starts in
// his place (DropFor, an index into what it takes in) and the slot that
// player takes (ForSlot); all -1 otherwise.
type Change struct {
	Gain     float64
	Drop     int
	DropFor  int
	DropSlot int
	ForSlot  int
	Fills    bool
	Open     int
	Room     bool
}

// stands is a side the finder may keep the trade for.
func (c Change) stands() bool { return c.Fills && c.Room }

// change is the side's change from losing out and taking in. The drop
// is looked for only when the side takes in more than it gives with no
// open spot and, unless always, only when it gains: a drop never raises
// a lineup, so the finder refuses a trade with no gain as it is.
func (s tradeSide) change(f *filler, out []int, in []*Candidate, always bool) Change {
	strength, filled := f.strength(f.swap(s.players, out, in...))
	c := Change{Gain: strength - s.base, Drop: -1, DropFor: -1, DropSlot: -1, ForSlot: -1, Fills: filled >= s.filled, Open: -1, Room: true}
	if !c.Fills {
		c.Open = s.emptied(f.out)
		return c
	}
	if len(in) <= len(out) || s.squad.Open || (!always && !positive(c.Gain)) {
		return c
	}
	var taken takenSpot
	c.Drop, taken = s.withDrop(f, out, in)
	c.Room = c.Drop >= 0
	if taken.by >= 0 {
		c.DropFor, c.DropSlot, c.ForSlot = taken.by, s.drops.spotOf(c.Drop), taken.slot
	}
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
// after the trade, never one the drop rule keeps; -1 for nobody. A player
// the fill does not start changes no slot, so every allowed drop leaves
// the lineup strength as it is and the one to drop is the last of them on
// our order. A player this week's lineup starts goes only when no bench
// player may (Lane 66u), and only when the move keeps this week's lineup
// full and starts one of in (takesHisSpot): who and where is the second
// answer (noSpot for none).
func (s tradeSide) withDrop(f *filler, out []int, in []*Candidate) (int, takenSpot) {
	f.strength(f.swap(s.players, out, in...))
	counts := s.countsAfter(out, in)
	bench, at := -1, 0
	var starters []int
	for d, p := range s.players {
		if contains(out, d) {
			continue
		}
		started := f.started(at)
		at++
		if started || !s.drops.allowed(d, in[0], counts) {
			continue
		}
		if s.drops.startsThisWeek(d) {
			starters = append(starters, d)
			continue
		}
		if bench < 0 || across(s.players[bench], p, false) {
			bench = d
		}
	}
	if bench >= 0 || len(starters) == 0 {
		return bench, noSpot
	}
	// The one it costs least to lose first.
	sort.SliceStable(starters, func(i, j int) bool { return across(s.players[starters[j]], s.players[starters[i]], false) })
	taken := make([]Candidate, len(in))
	for k, c := range in {
		taken[k] = *c
	}
	for _, d := range starters {
		if spot := s.drops.takesHisSpot(d, out, taken); spot.by >= 0 {
			return d, spot
		}
	}
	return -1, noSpot
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
	me := newSide(f, config, mine, true)
	return &tradeSearch{f: f, me: me, them: newSide(f, config, theirs, false)}
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
		out = append(out, tradeOf(give, get, my, their))
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

// tradeOf is the trade from each side's change: the member's drop and
// both gains.
func tradeOf(give, get []int, my, their Change) Trade {
	return Trade{Give: give, Get: get, Drop: my.Drop, DropFor: my.DropFor, DropSlot: my.DropSlot, ForSlot: my.ForSlot, MyGain: my.Gain, TheirGain: their.Gain}
}

// Checked is one trade the member built, on the finder's reckoning: its
// figures as the finder would list them, each side's change, and each
// side's lineup strength before it (points over replacement a week, the
// figure each gain is a change in: Lane 66g's totals).
type Checked struct {
	Trade
	Mine       Change
	Theirs     Change
	MineBase   float64
	TheirsBase float64
}

// Check is the builder's trade (Lane 61): the member gives give and gets
// get (indexes into each squad), answered whatever its gains, with the
// drop a full roster makes for more in than out. The gains are the
// finder's own, so a trade the finder lists checks to its numbers.
func Check(config []draft.SlotConfig, weeks int, mine, theirs Squad, give, get []int) Checked {
	t := newSearch(config, weeks, mine, theirs)
	my, their := t.mine(give, get, true), t.theirs(give, get, true)
	return Checked{Trade: tradeOf(give, get, my, their), Mine: my, Theirs: their,
		MineBase: t.me.base, TheirsBase: t.them.base}
}

// WeekProj is this week's Proj total of the lineup the Lineup screen sets
// from roster (Lane 66g): §4.2's fill by the week's keys, the starters
// whose games have kicked off kept where they are, a spot no one who can
// play fills counting nothing. A starter with no Proj adds none.
func WeekProj(config []draft.SlotConfig, roster []Candidate, starters []string) float64 {
	total := 0.0
	for _, r := range Lineup(config, roster, starters) {
		if r.Ours < 0 || r.NoOneCanPlay {
			continue
		}
		if c := roster[r.Ours]; c.HasProj {
			total += c.Proj
		}
	}
	return total
}

// Swapped is roster less the players at out with in appended: a side's
// roster after a trade, in a new slice.
func Swapped(roster []Candidate, out []int, in []Candidate) []Candidate {
	next := make([]Candidate, 0, len(roster)+len(in))
	for i, c := range roster {
		if !contains(out, i) {
			next = append(next, c)
		}
	}
	return append(next, in...)
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
