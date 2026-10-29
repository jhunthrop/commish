package inseason

import (
	"slices"
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
// MyGain and TheirGain are each best lineup's change a week over those
// weeks, week by week with the byes (Lane 287). Fills and TheirFills are
// the need of each side's the trade fills (TradeLeague.filled, an index
// into Slots, -1 for none); Gives the position the member gives from his
// surplus or where his bench covers the loss ("" for neither); Opens
// whether the trade opens a need of the member's or deepens one
// (TradeLeague.opens); MyWeek this week's Proj change
// to the member's lineup, the order's tiebreak.
type Trade struct {
	Give       []int
	Get        []int
	Drop       int
	DropFor    int
	DropSlot   int
	ForSlot    int
	MyGain     float64
	TheirGain  float64
	MyRest     float64
	TheirRest  float64
	Need       int
	Fills      int
	TheirFills int
	Gives      draft.Position
	Opens      bool
	MyWeek     float64
}

// tradeSide is one squad as the search reads it: its players, its
// strength before the trade, the slots it fills, the players it may
// trade, whether its holds count (the member's own), and who it may drop
// (the rule Waivers reads too).
// slots is its best lineup's points at each starting slot before the
// trade and needs the slots that fall below the league's median there
// (Lane 287).
type tradeSide struct {
	squad     Squad
	players   []*Candidate
	base      float64
	filled    int
	baseFill  []bool
	tradeable []int
	own       bool
	drops     dropRule
	slots     []float64
	needs     []Need
	// flatBase is the rest-of-season fill's strength before the trade.
	flatBase float64
	// needPositions is the positions its needs' slots take.
	needPositions map[draft.Position]bool
}

// tradeFill is the search's two fills: the rest-of-season fill with
// nobody's week counted, which says which slots a roster fills and whom
// it starts (the drop rule's), and the week-by-week fill whose points a
// week are the lineup's strength (Lane 287).
type tradeFill struct {
	f *filler
	w *weekFill
}

// strength is the lineup's points over replacement a week, week by week
// with the byes, and how many slots it fills; the rest-of-season fill's
// starters stay read for started.
func (t tradeFill) strength(pool []*Candidate) (float64, int) {
	week, _, filled := t.both(pool)
	return week, filled
}

// both is strength with the rest-of-season fill's own figure a week
// (flat), the one the drop rule ranks drops by.
func (t tradeFill) both(pool []*Candidate) (week, flat float64, filled int) {
	flat, filled = t.f.strength(pool)
	return t.w.perWeek(pool), flat, filled
}

func newSide(f tradeFill, l TradeLeague, squad Squad, own bool) tradeSide {
	var held map[string]bool
	if own {
		held = squad.Held
	}
	s := tradeSide{squad: squad, players: pointers(squad.Players), own: own, drops: newDropRule(l.Config, squad, held)}
	s.base, s.flatBase, s.filled = f.both(s.players)
	s.baseFill = make([]bool, len(f.f.out))
	for i, p := range f.f.out {
		s.baseFill[i] = p >= 0
	}
	s.slots = append([]float64(nil), f.w.slotPoints(s.players)...)
	s.needs = l.Needs(TeamProfile{Slots: s.slots})
	s.needPositions = map[draft.Position]bool{}
	for _, n := range s.needs {
		for _, p := range l.slots[n.Slot].Eligible {
			s.needPositions[p] = true
		}
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
func (s tradeSide) change(f tradeFill, out []int, in []*Candidate, always bool) Change {
	strength, flat, filled := f.both(f.f.swap(s.players, out, in...))
	c := Change{Gain: strength - s.base, Drop: -1, DropFor: -1, DropSlot: -1, ForSlot: -1, Fills: filled >= s.filled, Open: -1, Room: true}
	if !c.Fills {
		c.Open = s.emptied(f.f.out)
		return c
	}
	if len(in) <= len(out) || s.squad.Open || (!always && printedSign(c.Gain) <= 0) {
		return c
	}
	drop, ok := s.withDrop(f, flat-s.flatBase, out, in)
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
//
// The drops are ranked on the rest-of-season fill's figure (gain is the
// trade's on it, before any drop), the week-by-week fill reckoned once for
// the drop chosen (Lane 287 fix round: it is the search's dearest step).
func (s tradeSide) withDrop(f tradeFill, gain float64, out []int, in []*Candidate) (dropOption, bool) {
	counts := s.countsAfter(out, in)
	taken := make([]Candidate, len(in))
	for k, c := range in {
		taken[k] = *c
	}
	f.f.strength(f.f.swap(s.players, out, in...))
	var options []dropOption
	var started []int
	at := 0
	for d := range s.players {
		if contains(out, d) {
			continue
		}
		starts := f.f.started(at)
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
		flat, filled := f.f.strength(f.f.swap(s.players, withOne(out, d), in...))
		if filled >= s.filled {
			options = append(options, dropOption{at: d, gain: flat - s.flatBase, spot: noSpot})
		}
	}
	best, ok := s.drops.recommend(options, out, taken)
	if ok {
		best.gain = f.w.perWeek(f.f.swap(s.players, withOne(out, best.at), in...)) - s.base
	}
	return best, ok
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
// drop (-1 for none) and taking in (Lane 269): what the players it takes
// in score over the waiver level at their positions, less the same for
// those it sends out and drops. The waiver level is the best free agent's
// (Candidate.FreeLevel), so a bench back counts for what he scores over
// the back the side could pick up free, and a player at or under that
// level counts none: the side replaces him from waivers. Unlike the
// lineup gain it counts the bench, so a trade that fills one slot by
// giving up two players the side would keep shows what it costs.
func (s tradeSide) restOfSeason(out []int, drop int, in []*Candidate) float64 {
	total := 0.0
	for _, c := range in {
		total += overWaivers(c)
	}
	for _, o := range out {
		total -= overWaivers(s.players[o])
	}
	if drop >= 0 {
		total -= overWaivers(s.players[drop])
	}
	return total
}

// overWaivers is a player's rest-of-season points over the waiver level
// at his position, none at or under it or without a figure.
func overWaivers(c *Candidate) float64 {
	if !c.HasValue {
		return 0
	}
	return max(0, c.Value-c.FreeLevel)
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
// close calls for them after; inside each, the trades that fill one of
// the member's needs first (Lane 287), then by the member's rest-of-season
// gain as a page prints it, this week's Proj change, then theirs: the
// first trade a page shows is one the other team can accept and the one
// that fills what the member's lineup lacks.
func orderTrades(trades []Trade) {
	// The printed figures are read once a trade: a search orders thousands.
	type keyed struct {
		trade Trade
		close bool
		gain  float64
	}
	keys := make([]keyed, len(trades))
	for i, tr := range trades {
		keys[i] = keyed{tr, tr.CloseForThem(), roundTenth(tr.MyGain)}
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.close != b.close {
			return !a.close
		}
		if (a.trade.Fills >= 0) != (b.trade.Fills >= 0) {
			return a.trade.Fills >= 0
		}
		if a.gain != b.gain {
			return a.gain > b.gain
		}
		if a.trade.MyWeek != b.trade.MyWeek {
			return a.trade.MyWeek > b.trade.MyWeek
		}
		return a.trade.TheirGain > b.trade.TheirGain
	})
	for i, k := range keys {
		trades[i] = k.trade
	}
}

// tradeSearch is the two sides of one team's trades in the league, with
// the buffer the players taken in are read into, the member's lineup this
// week before any trade (week, set on the first need asked) and its Proj
// total (myWeek), and the member's surplus (TradeLeague.Surplus).
type tradeSearch struct {
	f       tradeFill
	league  TradeLeague
	config  []draft.SlotConfig
	me      tradeSide
	them    tradeSide
	buffer  []*Candidate
	week    *weekLineup
	surplus []int
	myWeek  float64
}

func newSearch(l TradeLeague, mine, theirs Squad) *tradeSearch {
	f := tradeFill{f: newFiller(Slots(l.Config), l.Weeks()), w: l.fill()}
	return &tradeSearch{f: f, league: l, config: l.Config, me: newSide(f, l, mine, true), them: newSide(f, l, theirs, false),
		surplus: l.Surplus(mine.Players), myWeek: WeekProj(l.Config, mine.Players, mine.Starters)}
}

// need is the first starting spot of the member's lineup this week, set
// as the Lineup screen sets it, that no one of his who can play fills
// and that the trade fills: he gives give and drop (-1 for none) and gets
// get. -1 for none, and -1 when the trade leaves empty a spot that was
// filled, which fills no need.
func (t *tradeSearch) need(give []int, drop int, get []int) int {
	filled, _ := t.weekSpots(give, drop, get)
	return filled
}

// weekSpots is need's spot, and whether the trade leaves empty a spot of
// this week's lineup that someone who can play filled (Lane 287: the
// finder never sends out the one player who can start there this week).
func (t *tradeSearch) weekSpots(give []int, drop int, get []int) (int, bool) {
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
			return -1, true
		case idle && !after.idle[i] && filled < 0:
			filled = i
		}
	}
	return filled, false
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

// Trades is §6.2's search between the member's squad and one other team's
// in the league: exact over every one-for-one, two-for-one, one-for-two
// and two-for-two at the skill positions (Lane 287), a trade kept when
//   - the member's best lineup gains over the weeks left, byes counted;
//   - both sides still fill every slot and have room for what they take;
//   - neither side gives up more rest of season than Acceptable allows
//     (Lane 269);
//   - the other side takes it (sideTakes): its lineup gains, or the trade
//     fills one of its needs and its lineup loses nothing;
//   - it fills a need on at least one side, and opens or deepens no
//     need of the member's (Lane 287);
//   - it is proposable (Lane 103);
//   - and it is not another kept trade with a player added that does not
//     raise the member's gain (padded).
//
// focus, when set, keeps only trades holding that player (either side's
// id). The best limit trades in orderTrades' order. Gains are a week's
// over the weeks the league's order covers.
func Trades(l TradeLeague, mine, theirs Squad, focus string, limit int) []Trade {
	return Narrow(AllTrades(l, mine, theirs), mine, theirs, focus, limit)
}

// AllTrades is every trade Trades keeps between the two squads, in
// orderTrades' order.
func AllTrades(l TradeLeague, mine, theirs Squad) []Trade { return Find(l, mine, theirs).Trades }

// EmptyReason is why the finder lists no trade with a team (Lane 290,
// B283): the API's empty_reason, "" while it lists one.
type EmptyReason string

const (
	// EmptySameNeed is a team whose needs take only positions the
	// member's needs take too: they need what he needs.
	EmptySameNeed EmptyReason = "same_need"
	// EmptyNoNeed is a team with no slot short of the median team.
	EmptyNoNeed EmptyReason = "no_need"
	// EmptyDropped is a search that found trades the member's lineup
	// gains from, none of them one they take or that fills a need
	// without opening one.
	EmptyDropped EmptyReason = "dropped"
	// EmptyNothing is a search that found no trade the member's lineup
	// gains from.
	EmptyNothing EmptyReason = "nothing"
)

// Found is one team's search: every trade Trades keeps, in orderTrades'
// order, and why there is none when there is none.
type Found struct {
	Trades []Trade
	Empty  EmptyReason
}

// Find is the search a league read runs once a team (Service.finds):
// AllTrades' trades, and when none is kept, the reason from the search's
// own reading of both sides' needs and of what it found.
func Find(l TradeLeague, mine, theirs Squad) Found {
	t := newSearch(l, mine, theirs)
	var out []Trade
	gained := false
	try := func(give, get []int) {
		if !t.couldFill(give, get) || !t.restPossible(give, get) {
			return
		}
		my := t.mine(give, get, false)
		if !my.stands() || printedSign(my.Gain) <= 0 {
			return
		}
		gained = true
		// Their drop is looked for only where they could take the trade: a
		// drop never raises a lineup, so one that falls already is refused,
		// and one that holds even is reckoned again with its drop.
		their := t.theirs(give, get, false)
		if printedSign(their.Gain) < 0 {
			return
		}
		if printedSign(their.Gain) == 0 {
			their = t.theirs(give, get, true)
		}
		if !their.stands() {
			return
		}
		tr := t.tradeOf(give, get, my, their)
		if !Acceptable(tr.MyRest, l.Weeks()) || !sideTakes(tr.TheirRest, tr.TheirGain, tr.TheirFills, l.Weeks()) ||
			(tr.Fills < 0 && tr.TheirFills < 0) || tr.Opens {
			return
		}
		need, empties := t.weekSpots(give, tr.Drop, get)
		tr.Need = need
		if !empties && proposable(tr, mine.Players) {
			tr.MyWeek = t.weekChange(tr)
			out = append(out, tr)
		}
	}
	for _, shape := range tradeShapes {
		for _, give := range shape.give(t.me.tradeable) {
			for _, get := range shape.get(t.them.tradeable) {
				try(give, get)
			}
		}
	}
	out = withoutPadding(out)
	orderTrades(out)
	if len(out) > 0 {
		return Found{Trades: out}
	}
	return Found{Trades: out, Empty: t.emptyReason(gained)}
}

// emptyReason is why a search kept no trade: the other side's needs first
// (none, or only what the member needs too), since they say why the side
// takes nothing; then whether any trade gained the member's lineup.
func (t *tradeSearch) emptyReason(gained bool) EmptyReason {
	switch {
	case len(t.them.needs) == 0:
		return EmptyNoNeed
	case t.sameNeeds():
		return EmptySameNeed
	case gained:
		return EmptyDropped
	}
	return EmptyNothing
}

// sameNeeds is whether every position the other side's needs take is one
// the member's needs take too.
func (t *tradeSearch) sameNeeds() bool {
	for p := range t.them.needPositions {
		if !t.me.needPositions[p] {
			return false
		}
	}
	return true
}

// withoutPadding is trades less each one that holds another of them with
// a player added on either side and gains the member no more as a page
// prints it, nor is a close call where the other is not: the same idea
// with a player along who changes nothing.
func withoutPadding(trades []Trade) []Trade {
	out := make([]Trade, 0, len(trades))
	for i, tr := range trades {
		padded := false
		for j, smaller := range trades {
			if i != j && pads(tr, smaller) {
				padded = true
				break
			}
		}
		if !padded {
			out = append(out, tr)
		}
	}
	return out
}

// pads is whether tr is smaller with players added that gain the member
// nothing.
func pads(tr, smaller Trade) bool {
	if len(smaller.Give)+len(smaller.Get) >= len(tr.Give)+len(tr.Get) || !subset(smaller.Give, tr.Give) || !subset(smaller.Get, tr.Get) {
		return false
	}
	if smaller.CloseForThem() && !tr.CloseForThem() {
		return false
	}
	return roundTenth(smaller.MyGain) >= roundTenth(tr.MyGain)
}

func subset(small, big []int) bool {
	for _, p := range small {
		if !slices.Contains(big, p) {
			return false
		}
	}
	return true
}

// tradeShape is one count of players a side: each side's lists from its
// tradeable players.
type tradeShape struct{ give, get func([]int) [][]int }

// tradeShapes is the finder's reach: one or two players a side.
var tradeShapes = []tradeShape{{singles, singles}, {pairs, singles}, {singles, pairs}, {pairs, pairs}}

// singles is each of at alone.
func singles(at []int) [][]int {
	out := make([][]int, len(at))
	for i, p := range at {
		out[i] = []int{p}
	}
	return out
}

// sideTakes is whether a side takes a trade (Lane 287): it gives up no
// more rest of season than Acceptable allows (Lane 269), and its lineup
// gains, or the trade fills one of its needs (fills, -1 for none) and its
// lineup loses nothing, as a page prints it.
func sideTakes(rest, gain float64, fills, weeks int) bool {
	if !Acceptable(rest, weeks) {
		return false
	}
	if fills >= 0 {
		return roundTenth(gain) >= 0
	}
	return positive(gain)
}

// couldFill is whether the trade could fill a need on either side: a slot
// rises only when a player who can play there comes in, so a trade that
// brings neither side a player at a position its needs take fills none
// (the search's cheapest refusal).
func (t *tradeSearch) couldFill(give, get []int) bool {
	return t.me.wants(t.them.players, get) || t.them.wants(t.me.players, give)
}

// wants is whether any of players at in can play at one of the side's
// needs.
func (s tradeSide) wants(players []*Candidate, in []int) bool {
	for _, p := range in {
		if s.needPositions[players[p].Position] {
			return true
		}
	}
	return false
}

// restPossible is whether both sides could still take the trade on rest
// of season: a drop only lowers a side's, so a trade either side refuses
// before any drop is refused after one.
func (t *tradeSearch) restPossible(give, get []int) bool {
	t.buffer = t.them.at(get, t.buffer)
	mine := t.me.restOfSeason(give, -1, t.buffer)
	t.buffer = t.me.at(give, t.buffer)
	theirs := t.them.restOfSeason(get, -1, t.buffer)
	return roughlyAcceptable(mine, t.league.Weeks()) && roughlyAcceptable(theirs, t.league.Weeks())
}

// printedSign is the sign of a figure as a page prints it to the tenth,
// the tenth read only near zero (as roughlyAcceptable).
func printedSign(v float64) int {
	switch {
	case v >= 0.06:
		return 1
	case v <= -0.06:
		return -1
	case v > -0.04 && v < 0.04:
		return 0
	}
	switch t := roundTenth(v); {
	case t > 0:
		return 1
	case t < 0:
		return -1
	}
	return 0
}

// roughlyAcceptable is Acceptable, the printed tenth read only near the
// limit: a figure a tenth or more clear of it falls the same side however
// it prints, and the search asks thousands of times a read.
func roughlyAcceptable(rest float64, weeks int) bool {
	limit := -GiveUp(weeks)
	switch {
	case rest >= limit+0.1:
		return true
	case rest < limit-0.1:
		return false
	}
	return Acceptable(rest, weeks)
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
// against it, the need each side's lineup fills and what the member
// gives.
func (t *tradeSearch) tradeOf(give, get []int, my, their Change) Trade {
	t.buffer = t.them.at(get, t.buffer)
	myRest := t.me.restOfSeason(give, my.Drop, t.buffer)
	t.buffer = t.me.at(give, t.buffer)
	theirRest := t.them.restOfSeason(get, their.Drop, t.buffer)
	tr := Trade{Give: give, Get: get, Drop: my.Drop, DropFor: my.DropFor, DropSlot: my.DropSlot, ForSlot: my.ForSlot,
		MyGain: my.Gain, TheirGain: their.Gain, MyRest: myRest, TheirRest: theirRest, Need: -1}
	mineAfter := t.slotsAfter(t.me, withDrop(give, my.Drop), t.them.at(get, t.buffer))
	tr.Fills = t.league.filled(t.me.needs, t.me.slots, mineAfter)
	tr.Gives = t.gives(give, mineAfter)
	tr.Opens = t.league.opens(t.me.needs, t.league.Needs(TeamProfile{Slots: mineAfter}))
	theirsAfter := t.slotsAfter(t.them, withDrop(get, their.Drop), t.me.at(give, t.buffer))
	tr.TheirFills = t.league.filled(t.them.needs, t.them.slots, theirsAfter)
	return tr
}

// opens is whether the trade leaves a need the side did not have (a slot
// in after's needs not in before's), or one it had deeper by CloseCall a
// week or more (Lane 287 fix round, HIGH-1): a trade never makes a hole
// to fill another.
func (l TradeLeague) opens(before, after []Need) bool {
	least := CloseCall * float64(l.Weeks())
	for _, n := range after {
		at := slices.IndexFunc(before, func(b Need) bool { return b.Slot == n.Slot })
		if at < 0 || roundTenth(n.Short-before[at].Short) >= least {
			return true
		}
	}
	return false
}

// withDrop is out with the drop (-1 for none) added, in a new slice.
func withDrop(out []int, drop int) []int {
	if drop < 0 {
		return out
	}
	return append(append([]int(nil), out...), drop)
}

// slotsAfter is a side's best lineup's points at each slot after it
// loses out and takes in, in a new slice.
func (t *tradeSearch) slotsAfter(s tradeSide, out []int, in []*Candidate) []float64 {
	return append([]float64(nil), t.f.w.slotPoints(t.f.f.swap(s.players, out, in...))...)
}

// gives is the position the member gives from (Lane 287): the first
// player he gives who is surplus, or whose position's own slots stay at
// the league's median or over after the trade (his bench covers the
// loss); "" for none.
func (t *tradeSearch) gives(give []int, after []float64) draft.Position {
	for _, g := range give {
		p := t.me.players[g].Position
		if slices.Contains(t.surplus, g) || t.covered(p, after) {
			return p
		}
	}
	return ""
}

// covered is whether every slot only p takes holds the league's median
// or over in after.
func (t *tradeSearch) covered(p draft.Position, after []float64) bool {
	own := false
	for i, s := range t.league.slots {
		if s.shared() || !s.accepts(p) {
			continue
		}
		own = true
		if after[i] < t.league.Median[i] {
			return false
		}
	}
	return own
}

// weekChange is this week's Proj change to the member's lineup from the
// trade, each lineup set as the Lineup screen sets it.
func (t *tradeSearch) weekChange(tr Trade) float64 {
	squad := t.me.squad
	after := Swapped(squad.Players, withDrop(tr.Give, tr.Drop), candidatesOf(t.them.squad.Players, tr.Get))
	return WeekProj(t.config, after, squad.Starters) - t.myWeek
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
func Check(l TradeLeague, mine, theirs Squad, give, get []int) Checked {
	t := newSearch(l, mine, theirs)
	my, their := t.mine(give, get, true), t.theirs(give, get, true)
	tr := t.tradeOf(give, get, my, their)
	tr.Need = t.need(give, tr.Drop, get)
	tr.MyWeek = t.weekChange(tr)
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
