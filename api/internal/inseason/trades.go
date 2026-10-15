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
// gets (indexes into each squad) and each side's gain in points over
// replacement a week.
type Trade struct {
	Give      []int
	Get       []int
	MyGain    float64
	TheirGain float64
}

// tradeSide is one squad as the search reads it: its players, its
// strength before the trade, the slots it fills, and the players it may
// trade.
type tradeSide struct {
	squad     Squad
	players   []*Candidate
	base      float64
	filled    int
	tradeable []int
}

func newSide(f *filler, squad Squad, own bool) tradeSide {
	s := tradeSide{squad: squad, players: pointers(squad.Players)}
	s.base, s.filled = f.strength(s.players)
	for i, c := range squad.Players {
		if skill(c.Position) && !c.InjuredReserve && !(own && squad.Held[c.ID]) {
			s.tradeable = append(s.tradeable, i)
		}
	}
	return s
}

// gain is the side's gain from losing out and taking in, and whether it
// still fills every slot it filled.
func (s tradeSide) gain(f *filler, out []int, in []*Candidate) (float64, bool) {
	strength, filled := f.strength(f.swap(s.players, out, in...))
	return strength - s.base, filled >= s.filled
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

// Trades is §6.2's search between the member's squad and one other team's:
// exact over every one-for-one and two-for-one pair both ways at the
// skill positions, a trade kept when both lineups gain and both still
// fill every slot. focus, when set, keeps only trades holding that
// player (either side's id). The best limit trades in orderTrades' order.
func Trades(config []draft.SlotConfig, mine, theirs Squad, focus string, limit int) []Trade {
	f := newFiller(Slots(config))
	me, them := newSide(f, mine, true), newSide(f, theirs, false)
	var out []Trade
	var in []*Candidate
	try := func(give, get []int) {
		if focus != "" && !holds(me, give, focus) && !holds(them, get, focus) {
			return
		}
		in = them.at(get, in)
		myGain, ok := me.gain(f, give, in)
		if !ok || !positive(myGain) {
			return
		}
		in = me.at(give, in)
		theirGain, ok := them.gain(f, get, in)
		if !ok || !positive(theirGain) {
			return
		}
		out = append(out, Trade{Give: give, Get: get, MyGain: myGain, TheirGain: theirGain})
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
