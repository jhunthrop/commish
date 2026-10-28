package inseason

import (
	"math"
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// TradesPerTeam is how many trades a team's list shows, best for the
// member first.
const TradesPerTeam = 10

// CloseCall is the gain a week under which a trade is a close call for
// the other side (§6.2).
const CloseCall = 0.5

// KeepGain is the least gain a week, as a page prints it, a trade that
// sends out a player our order keeps must bring the member's lineup
// (Lane 103, B43), unless it fills a need.
const KeepGain = 1.0

// GiveUpPerWeek is the most rest-of-season points over replacement a
// week, as a page prints it, a side may give up and still take a trade
// (Lane 269). A manager takes a trade that costs him a little rest of
// season for a lineup need: a point a week sits inside our order's own
// spread between neighbours at a position, and is the gain a page first
// prints as one (KeepGain). A starter's points over replacement run to
// several a week, so a trade that costs a side a starter is past it.
const GiveUpPerWeek = 1.0

// Trade is one trade both lineups gain from: who the member gives and
// gets (indexes into each squad), who the member drops to make room
// (Drop, -1 for none) and each side's gain in points over replacement a
// week, after any drop. A drop this week's lineup starts names his spot
// (DropSlot, an index into Slots), the player of Get who starts with the
// lineup kept full (DropFor, an index into Get) and the slot that player
// takes (ForSlot); all -1 for a bench drop or none. Need is the
// starting spot of this week's lineup no one of the member's who can play
// fills that the trade fills (an index into Slots, -1 for none). MyRest
// and TheirRest are each side's rest-of-season change (restOfSeason) over
// the weeks the order covers, each side's drop counted against it.
type Trade struct {
	Give      []int
	Get       []int
	Drop      int
	DropFor   int
	DropSlot  int
	ForSlot   int
	MyGain    float64
	TheirGain float64
	MyRest    float64
	TheirRest float64
	Need      int
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

// change is the side's change from losing out and taking in, its gain
// after any drop. The drop is looked for only when the side takes in more
// than it gives with no open spot and, unless always, only when it gains:
// a drop never raises a lineup, so the finder refuses a trade with no gain
// as it is.
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
	drop, ok := s.withDrop(f, c.Gain, out, in)
	c.Room = ok
	if !ok {
		return c
	}
	c.Drop, c.Gain = drop.at, drop.gain
	if drop.spot.by >= 0 {
		c.DropFor, c.DropSlot, c.ForSlot = drop.spot.by, s.drops.spotOf(drop.at), drop.spot.slot
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

// withDrop is §5.2's drop for a roster a trade grows past its spots
// (coordinator's ruling, Lane 66u): never one it gives, never one the drop
// rule keeps, never one whose loss leaves a rest-of-season slot empty;
// every other drop goes to recommend, as Waivers' do, which keeps those
// that keep this week's lineup full and takes the largest rest-of-season
// gain. False for nobody. A player the rest-of-season fill after the
// trade does not start changes no slot, so his gain is the trade's as it
// is, gain; each player it starts is reckoned by a fill without him.
func (s tradeSide) withDrop(f *filler, gain float64, out []int, in []*Candidate) (dropOption, bool) {
	counts := s.countsAfter(out, in)
	taken := make([]Candidate, len(in))
	for k, c := range in {
		taken[k] = *c
	}
	f.strength(f.swap(s.players, out, in...))
	var options []dropOption
	var started []int
	at := 0
	for d := range s.players {
		if contains(out, d) {
			continue
		}
		starts := f.started(at)
		at++
		switch {
		case !s.drops.allowed(d, in[0], counts):
		case starts:
			started = append(started, d)
		default:
			options = append(options, dropOption{at: d, gain: gain, spot: noSpot})
		}
	}
	for _, d := range started {
		strength, filled := f.strength(f.swap(s.players, withOne(out, d), in...))
		if filled >= s.filled {
			options = append(options, dropOption{at: d, gain: strength - s.base, spot: noSpot})
		}
	}
	return s.drops.recommend(options, out, taken)
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

// restOfSeason is the side's rest-of-season change from losing out and
// drop (-1 for none) and taking in (Lane 269): the points over
// replacement of the players it takes in less those it sends out and
// drops, each counted at replacement or above, since a player under it is
// one a manager replaces from waivers. Unlike the lineup gain it counts
// the bench, so a trade that fills one slot by giving up two players the
// side would keep shows what it costs.
func (s tradeSide) restOfSeason(out []int, drop int, in []*Candidate) float64 {
	total := 0.0
	for _, c := range in {
		total += overReplacement(c)
	}
	for _, o := range out {
		total -= overReplacement(s.players[o])
	}
	if drop >= 0 {
		total -= overReplacement(s.players[drop])
	}
	return total
}

// overReplacement is a player's rest-of-season points over replacement,
// none under replacement or without a figure.
func overReplacement(c *Candidate) float64 {
	if !c.HasValue {
		return 0
	}
	return max(0, c.Value)
}

// Acceptable is whether a side takes a trade whose rest-of-season change
// over weeks is rest: as a page prints it, it gives up no more than
// GiveUp(weeks).
func Acceptable(rest float64, weeks int) bool { return roundTenth(rest) >= -GiveUp(weeks) }

// GiveUp is the most rest of season a side gives up over weeks:
// GiveUpPerWeek for each.
func GiveUp(weeks int) float64 { return GiveUpPerWeek * float64(max(1, weeks)) }

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
// players taken in are read into and the member's lineup this week before
// any trade (week, set on the first need asked).
type tradeSearch struct {
	f      *filler
	config []draft.SlotConfig
	me     tradeSide
	them   tradeSide
	buffer []*Candidate
	week   *weekLineup
}

func newSearch(config []draft.SlotConfig, weeks int, mine, theirs Squad) *tradeSearch {
	f := newFiller(Slots(config), weeks)
	me := newSide(f, config, mine, true)
	return &tradeSearch{f: f, config: config, me: me, them: newSide(f, config, theirs, false)}
}

// need is the first starting spot of the member's lineup this week, set
// as the Lineup screen sets it, that no one of his who can play fills
// and that the trade fills: he gives give and drop (-1 for none) and gets
// get. -1 for none, and -1 when the trade leaves empty a spot that was
// filled, which fills no need.
func (t *tradeSearch) need(give []int, drop int, get []int) int {
	squad := t.me.squad
	if t.week == nil {
		base := weekOf(t.config, squad.Players, squad.Starters)
		t.week = &base
	}
	out := give
	if drop >= 0 {
		out = append(append([]int(nil), give...), drop)
	}
	after := weekOf(t.config, Swapped(squad.Players, out, candidatesOf(t.them.squad.Players, get)), squad.Starters)
	filled := -1
	for i, idle := range t.week.idle {
		switch {
		case !idle && after.idle[i]:
			return -1
		case idle && !after.idle[i] && filled < 0:
			filled = i
		}
	}
	return filled
}

// candidatesOf is the players at the indexes, in a new slice.
func candidatesOf(players []Candidate, at []int) []Candidate {
	out := make([]Candidate, len(at))
	for k, i := range at {
		out[k] = players[i]
	}
	return out
}

// Kept is a player our order keeps: the top player at his position, as
// the player page ranks him (Lane 103, B43).
func Kept(c Candidate) bool { return c.Rank == 1 }

// proposable is Lane 103's rule (B43): a trade that sends out a player
// our order keeps is proposed only when it gains the member's lineup
// KeepGain a week or more as the page prints it, or fills a need.
// mine is the member's squad's players, give's indexes into it.
func proposable(tr Trade, mine []Candidate) bool {
	return !givesKept(tr, mine) || earnsKeep(tr) || tr.Need >= 0
}

// needSaid is whether a row names the need it fills (Lane 103 fix round
// 1, HIGH-1): only where the need is why the rule lists it, a kept player
// given for under KeepGain a week. Every other row lists on its gains.
func needSaid(tr Trade, mine []Candidate) bool {
	return tr.Need >= 0 && givesKept(tr, mine) && !earnsKeep(tr)
}

// givesKept is whether the member gives a player our order keeps.
func givesKept(tr Trade, mine []Candidate) bool {
	for _, g := range tr.Give {
		if Kept(mine[g]) {
			return true
		}
	}
	return false
}

// earnsKeep is whether the trade gains the member KeepGain a week or
// more as the page prints it.
func earnsKeep(tr Trade) bool { return roundTenth(tr.MyGain) >= KeepGain }

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
// fill every slot, the other side giving up no more rest of season than
// Acceptable allows (Lane 269), and proposable (Lane 103). focus, when set, keeps
// only trades holding that player (either side's id). The best limit trades in orderTrades' order.
// Gains are a week's over the weeks the order covers.
func Trades(config []draft.SlotConfig, weeks int, mine, theirs Squad, focus string, limit int) []Trade {
	t := newSearch(config, weeks, mine, theirs)
	me, them := t.me, t.them
	var out []Trade
	try := func(give, get []int) {
		if !holdsFocus(mine.Players, theirs.Players, give, get, focus) {
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
		tr := t.tradeOf(give, get, my, their)
		if !Acceptable(tr.TheirRest, t.f.weeks) {
			return
		}
		tr.Need = t.need(give, tr.Drop, get)
		if proposable(tr, mine.Players) {
			out = append(out, tr)
		}
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

// AllTrades is every trade Trades keeps between the two squads, in
// orderTrades' order: the search a league read runs once (Service.finds).
func AllTrades(config []draft.SlotConfig, weeks int, mine, theirs Squad) []Trade {
	return Trades(config, weeks, mine, theirs, "", math.MaxInt)
}

// Narrow is Trades' focus and limit applied to all, one search's trades in
// orderTrades' order: the answer Trades gives with them, without searching
// again.
func Narrow(all []Trade, mine, theirs Squad, focus string, limit int) []Trade {
	out := make([]Trade, 0, min(len(all), limit))
	for _, tr := range all {
		if len(out) == limit {
			break
		}
		if holdsFocus(mine.Players, theirs.Players, tr.Give, tr.Get, focus) {
			out = append(out, tr)
		}
	}
	return out
}

// holdsFocus is whether a trade holds the focus player on either side
// ("" holds every trade).
func holdsFocus(mine, theirs []Candidate, give, get []int, focus string) bool {
	return focus == "" || holds(mine, give, focus) || holds(theirs, get, focus)
}

// tradeOf is the trade from each side's change: the member's drop, both
// gains and both rest-of-season changes, each side's drop counted
// against it.
func (t *tradeSearch) tradeOf(give, get []int, my, their Change) Trade {
	t.buffer = t.them.at(get, t.buffer)
	myRest := t.me.restOfSeason(give, my.Drop, t.buffer)
	t.buffer = t.me.at(give, t.buffer)
	theirRest := t.them.restOfSeason(get, their.Drop, t.buffer)
	return Trade{Give: give, Get: get, Drop: my.Drop, DropFor: my.DropFor, DropSlot: my.DropSlot, ForSlot: my.ForSlot,
		MyGain: my.Gain, TheirGain: their.Gain, MyRest: myRest, TheirRest: theirRest, Need: -1}
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
	tr := t.tradeOf(give, get, my, their)
	tr.Need = t.need(give, tr.Drop, get)
	return Checked{Trade: tr, Mine: my, Theirs: their, MineBase: t.me.base, TheirsBase: t.them.base}
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

func holds(players []Candidate, at []int, id string) bool {
	for _, p := range at {
		if players[p].ID == id {
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
