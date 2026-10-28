package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Tier is §4.2's first two keys: who may start this week.
type Tier int

// Tiers, best first. Out is a bye, a designation that keeps him off the
// field (out, injured reserve, suspended, PUP, NFI), or the host's IR
// mark; doubtful starts only where nobody eligible is better.
const (
	Available Tier = iota
	Doubtful
	Out
)

// Candidate is one rostered player as the engine orders him.
type Candidate struct {
	ID       string
	Position draft.Position
	// Rank is his place at his position in our order, 0 when unranked.
	Rank int
	// Value is points over replacement for the league's season, valid
	// when HasValue.
	Value    float64
	HasValue bool
	// PerGame is his points a game so far under the league's scoring,
	// valid when HasPerGame.
	PerGame    float64
	HasPerGame bool
	// Proj is this week's projection in the league's closest scoring, the
	// figure the Lineup screen shows, valid when HasProj (Lane 66e).
	Proj    float64
	HasProj bool
	Tier    Tier
	// Locked is a player whose game has kicked off: he cannot be moved
	// into or out of the lineup.
	Locked bool
	// InjuredReserve is a player listed on injured reserve: he counts in
	// no lineup strength and is never traded.
	InjuredReserve bool
	// FreeLevel is the waiver level at his position (Lane 269): the points
	// over replacement of the best free agent there, what a side that
	// loses him could pick up. 0, the last starter's level, where the
	// league's free agents are not read.
	FreeLevel float64
}

// Slot is one starting spot: its type, the positions it takes and its
// index among slots of its type.
type Slot struct {
	Type     draft.SlotType
	Eligible []draft.Position
	Index    int
}

func (s Slot) accepts(p draft.Position) bool {
	for _, e := range s.Eligible {
		if e == p {
			return true
		}
	}
	return false
}

func (s Slot) shared() bool { return len(s.Eligible) > 1 }

// Slots is the league's starting spots in the engine's config order
// (mock.SlotConfig: starters, the flex spots, K, DEF), the bench left out.
func Slots(config []draft.SlotConfig) []Slot {
	var out []Slot
	for _, c := range config {
		if c.Slot == draft.SlotBench {
			continue
		}
		for i := 0; i < c.Count; i++ {
			out = append(out, Slot{Type: c.Slot, Eligible: c.EligiblePositions, Index: i})
		}
	}
	return out
}

// startingConfig is the config without the bench: what AssignSlot fills.
func startingConfig(config []draft.SlotConfig) []draft.SlotConfig {
	out := make([]draft.SlotConfig, 0, len(config))
	for _, c := range config {
		if c.Slot != draft.SlotBench {
			out = append(out, c)
		}
	}
	return out
}

// withinBetter is §4.2's order inside one position for this week: tier,
// then our position order, then points over replacement, then points a
// game.
func withinBetter(a, b *Candidate) bool { return within(a, b, true) }

// acrossBetter orders players of different positions for a shared slot
// this week: a position rank says nothing about another position, so
// after the tier the points over replacement decide, then the rank,
// then the form.
func acrossBetter(a, b *Candidate) bool { return across(a, b, true) }

// within and across are the two orders, with this week's keys or, for
// the rest-of-season lineup strength, without them.
func within(a, b *Candidate, week bool) bool {
	if decided, better := weekKeys(a, b, week); decided {
		return better
	}
	if (a.Rank == 0) != (b.Rank == 0) {
		return a.Rank != 0
	}
	if a.Rank != b.Rank {
		return a.Rank < b.Rank
	}
	return valueThenForm(a, b)
}

func across(a, b *Candidate, week bool) bool {
	if decided, better := weekKeys(a, b, week); decided {
		return better
	}
	if a.HasValue != b.HasValue {
		return a.HasValue
	}
	if a.HasValue && a.Value != b.Value {
		return a.Value > b.Value
	}
	if a.Position == b.Position {
		return within(a, b, week)
	}
	return valueThenForm(a, b)
}

// weekKeys is the week's first keys, the advice rule the Lineup screen
// states (Lane 66e): the tier (a bye, and a designation that keeps him
// off the field, before anything else, so a Questionable player keeps his
// number), then the projection the screen shows, a player with one ahead
// of a player without, the higher first. decided is false when the keys
// tie or the order is not the week's: the rest-of-season order then
// breaks the tie, and stands in where neither has a projection.
func weekKeys(a, b *Candidate, week bool) (decided, better bool) {
	if !week {
		return false, false
	}
	if a.Tier != b.Tier {
		return true, a.Tier < b.Tier
	}
	if a.HasProj != b.HasProj {
		return true, a.HasProj
	}
	if a.HasProj && a.Proj != b.Proj {
		return true, a.Proj > b.Proj
	}
	return false, false
}

func valueThenForm(a, b *Candidate) bool {
	if a.HasValue != b.HasValue {
		return a.HasValue
	}
	if a.HasValue && a.Value != b.Value {
		return a.Value > b.Value
	}
	if a.HasPerGame != b.HasPerGame {
		return a.HasPerGame
	}
	if a.HasPerGame && a.PerGame != b.PerGame {
		return a.PerGame > b.PerGame
	}
	return a.ID < b.ID
}

// filler fills one league's slots, its buffers kept between calls: the
// trade search fills thousands of rosters a request.
type filler struct {
	// week orders by this week's tiers (the lineup); without it the fill
	// is the rest-of-season lineup strength's, nobody's week counted.
	week bool
	// weeks is how many weeks the order's points over replacement cover:
	// strength is a week's over them.
	weeks  int
	slots  []Slot
	shared []int
	open   []bool
	out    []int
	order  []int
	taken  []bool
	pool   []*Candidate
}

func newFiller(slots []Slot, weeks int) *filler {
	f := &filler{weeks: weeks, slots: slots, shared: sharedOrder(slots), open: make([]bool, len(slots)), out: make([]int, len(slots))}
	for i := range f.open {
		f.open[i] = true
	}
	return f
}

// fill puts the best of pool in every open slot: each position's own
// slots first, in config order, by the order inside the position; then
// the shared slots, narrowest first, by the order across positions.
// taken marks players already placed and is marked as players are; the
// answer is a pool index per slot, -1 where nobody eligible is left,
// good until the next call.
func (f *filler) fill(open []bool, pool []*Candidate, taken []bool) []int {
	for i := range f.out {
		f.out[i] = -1
	}
	f.order = f.order[:0]
	for i := range pool {
		f.order = append(f.order, i)
	}
	// An insertion sort: a roster is a few dozen players at most.
	order := f.order
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && within(pool[order[j]], pool[order[j-1]], f.week); j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
	for i, s := range f.slots {
		if !open[i] || s.shared() {
			continue
		}
		for _, p := range order {
			if !taken[p] && s.accepts(pool[p].Position) {
				f.out[i], taken[p] = p, true
				break
			}
		}
	}
	for _, i := range f.shared {
		if !open[i] {
			continue
		}
		best := -1
		for p := range pool {
			if taken[p] || !f.slots[i].accepts(pool[p].Position) {
				continue
			}
			if best < 0 || across(pool[p], pool[best], f.week) {
				best = p
			}
		}
		if best >= 0 {
			f.out[i], taken[best] = best, true
		}
	}
	return f.out
}

// strength is §5.2's lineup strength: the points over replacement a week
// (over the filler's weeks) summed over the slots the engine fills from pool (§4.2's fill on our
// order with no week tiers: a bye or this week's designation counts for
// nothing; the filler must not be a week filler), and how many slots it filled. A player
// on injured reserve fills nothing; a player with no points over
// replacement fills a slot and adds none.
func (f *filler) strength(pool []*Candidate) (float64, int) {
	f.taken = f.taken[:0]
	for _, c := range pool {
		f.taken = append(f.taken, c.InjuredReserve)
	}
	total, filled := 0.0, 0
	for _, p := range f.fill(f.open, pool, f.taken) {
		if p < 0 {
			continue
		}
		filled++
		if pool[p].HasValue {
			total += pool[p].Value
		}
	}
	return PerWeek(total, f.weeks), filled
}

// started reports whether the last fill started pool[at].
func (f *filler) started(at int) bool { return contains(f.out, at) }

// swap is base less the players at out, with in appended, in the
// filler's buffer: good until the next swap.
func (f *filler) swap(base []*Candidate, out []int, in ...*Candidate) []*Candidate {
	f.pool = f.pool[:0]
	for i, c := range base {
		if !contains(out, i) {
			f.pool = append(f.pool, c)
		}
	}
	f.pool = append(f.pool, in...)
	return f.pool
}

func contains(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// pointers is the roster as the filler reads it.
func pointers(roster []Candidate) []*Candidate {
	out := make([]*Candidate, len(roster))
	for i := range roster {
		out[i] = &roster[i]
	}
	return out
}

// sharedOrder is the shared slots, narrowest first, in config order
// among equals.
func sharedOrder(slots []Slot) []int {
	var out []int
	for width := 2; len(out) < countShared(slots); width++ {
		for i, s := range slots {
			if s.shared() && len(s.Eligible) == width {
				out = append(out, i)
			}
		}
	}
	return out
}

func countShared(slots []Slot) int {
	n := 0
	for _, s := range slots {
		if s.shared() {
			n++
		}
	}
	return n
}

// Row is one starting spot of the advised lineup: who we start, and who
// the host has there (-1 when the spot is empty on the host). Changed
// is a player we start whom the host has on the bench.
type Row struct {
	Slot    Slot
	Ours    int
	Host    int
	Changed bool
	// NoOneCanPlay is a spot no rostered player who can play this week
	// fills: Ours is the member's current player there, left in place, never
	// a recommendation (Lane 66e ruling).
	NoOneCanPlay bool
}

// Lineup is §4.2's lineup for the week from the roster (IR and taxi
// spots already left out) and the host's starters by id. A starter whose
// game has kicked off stays where the host has him and a benched one
// stays benched; every other spot is filled by the keys. The rows keep
// the host's spot for every player both lineups start where the slots
// allow it, so a change reads as one player for another.
func Lineup(config []draft.SlotConfig, roster []Candidate, hostStarters []string) []Row {
	slots := Slots(config)
	byID := make(map[string]int, len(roster))
	for i, c := range roster {
		byID[c.ID] = i
	}
	hostAt := hostSpots(config, slots, roster, byID, hostStarters)
	hostStarts := map[int]bool{}
	for _, p := range hostAt {
		if p >= 0 {
			hostStarts[p] = true
		}
	}
	taken := make([]bool, len(roster))
	open := make([]bool, len(slots))
	ours := make([]int, len(slots))
	for i := range slots {
		ours[i], open[i] = -1, true
		if p := hostAt[i]; p >= 0 && roster[p].Locked {
			ours[i], open[i], taken[p] = p, false, true
		}
	}
	for p, c := range roster {
		// A player who cannot play this week (a bye, out, doubtful, injured
		// reserve, suspended) never starts (Lane 66e ruling).
		if (c.Locked && !hostStarts[p]) || (!c.Locked && c.Tier != Available) {
			taken[p] = true
		}
	}
	week := newFiller(slots, SeasonGames)
	week.week = true
	for i, p := range week.fill(open, pointers(roster), taken) {
		if open[i] {
			ours[i] = p
		}
	}
	idle := keepWhereNoOneCanPlay(slots, roster, open, ours, hostAt)
	labelled := keepHostSpots(slots, roster, ours, hostAt)
	out := rows(slots, labelled, hostAt, hostStarts, roster)
	for i := range out {
		// A spot still empty after the fill and the keep: no one who can play
		// fills it and no member's starter is left for it (review N2).
		out[i].NoOneCanPlay = out[i].Ours < 0 || idle[out[i].Ours]
	}
	return out
}

// keepWhereNoOneCanPlay leaves the member's current player in each open
// spot the fill could not fill with a player who can play, when the fill
// placed him nowhere else, and returns those players.
//
// A member's starter the fill placed nowhere is one who cannot play (any
// starter who can would have taken a spot that takes him). His own spot is
// tried first; when the fill slid another starter into it, any empty spot
// that takes him holds him (review N1: an RB on bye, an RB in the flex,
// nobody else eligible), and the relabel then puts each back in his own
// spot.
func keepWhereNoOneCanPlay(slots []Slot, roster []Candidate, open []bool, ours, hostAt []int) map[int]bool {
	placed := map[int]bool{}
	for _, p := range ours {
		if p >= 0 {
			placed[p] = true
		}
	}
	idle := map[int]bool{}
	keep := func(i, h int) {
		ours[i], placed[h], idle[h] = h, true, true
	}
	for i := range ours {
		if h := hostAt[i]; open[i] && ours[i] < 0 && h >= 0 && !placed[h] {
			keep(i, h)
		}
	}
	for i := range ours {
		if !open[i] || ours[i] >= 0 {
			continue
		}
		for _, h := range hostAt {
			if h >= 0 && !placed[h] && slots[i].accepts(roster[h].Position) {
				keep(i, h)
				break
			}
		}
	}
	return idle
}

// hostSpots places the host's starters in our slots by draft.AssignSlot,
// in the host's order: each lands in the first slot of the config that
// takes him and has room. A starter no slot takes is left out.
func hostSpots(config []draft.SlotConfig, slots []Slot, roster []Candidate, byID map[string]int, starters []string) []int {
	at := make([]int, len(slots))
	for i := range at {
		at[i] = -1
	}
	starting := startingConfig(config)
	var placed []draft.RosterSlot
	for _, id := range starters {
		p, ok := byID[id]
		if !ok {
			continue
		}
		a := draft.AssignSlot(roster[p].Position, placed, starting)
		if !a.OK {
			continue
		}
		placed = append(placed, draft.RosterSlot{Slot: a.Slot, SlotIndex: a.SlotIndex, PlayerID: id})
		for i, s := range slots {
			if s.Type == a.Slot && s.Index == a.SlotIndex {
				at[i] = p
			}
		}
	}
	return at
}

// keepHostSpots relabels our starters so each sits in the host's spot
// for him where the slots allow: a matching of our starters to slots,
// each trying his host spot first (Kuhn's augmenting paths), which moves
// a kept starter only to make room the rules require.
func keepHostSpots(slots []Slot, roster []Candidate, ours, hostAt []int) []int {
	var starters []int
	for _, p := range ours {
		if p >= 0 {
			starters = append(starters, p)
		}
	}
	hostSpot := map[int]int{}
	for i, p := range hostAt {
		if p >= 0 {
			hostSpot[p] = i
		}
	}
	// The host's starters first, so each takes his own spot before a new
	// starter looks for room.
	sort.SliceStable(starters, func(i, j int) bool {
		_, a := hostSpot[starters[i]]
		_, b := hostSpot[starters[j]]
		return a && !b
	})
	m := matcher{slots: slots, roster: roster, hostSpot: hostSpot, slotOf: make([]int, len(slots))}
	for i := range m.slotOf {
		m.slotOf[i] = -1
	}
	for _, p := range starters {
		m.seen = make([]bool, len(slots))
		if !m.place(p) {
			return ours
		}
	}
	return m.slotOf
}

type matcher struct {
	slots    []Slot
	roster   []Candidate
	hostSpot map[int]int
	slotOf   []int
	seen     []bool
}

func (m *matcher) place(p int) bool {
	// His host spot, then a free spot, then a shared spot whose player
	// may move, then the rest: the fewest kept starters change rows.
	order := make([]int, 0, 2*len(m.slots))
	if s, ok := m.hostSpot[p]; ok {
		order = append(order, s)
	}
	for i := range m.slots {
		if m.slotOf[i] < 0 {
			order = append(order, i)
		}
	}
	for i, s := range m.slots {
		if s.shared() {
			order = append(order, i)
		}
	}
	for i := range m.slots {
		order = append(order, i)
	}
	for _, i := range order {
		if m.seen[i] || !m.slots[i].accepts(m.roster[p].Position) {
			continue
		}
		m.seen[i] = true
		if m.slotOf[i] < 0 || m.place(m.slotOf[i]) {
			m.slotOf[i] = p
			return true
		}
	}
	return false
}

// rows pairs each new starter with a host starter we sit: the one in his
// spot when the host had someone there we sit, else one of his position,
// else any left.
func rows(slots []Slot, ours, hostAt []int, hostStarts map[int]bool, roster []Candidate) []Row {
	weStart := map[int]bool{}
	for _, p := range ours {
		if p >= 0 {
			weStart[p] = true
		}
	}
	sat := map[int]bool{}
	for p := range hostStarts {
		if !weStart[p] {
			sat[p] = true
		}
	}
	out := make([]Row, len(slots))
	for i, s := range slots {
		out[i] = Row{Slot: s, Ours: ours[i], Host: -1}
		p := ours[i]
		if p < 0 {
			out[i].Host = hostAt[i]
			continue
		}
		if hostStarts[p] {
			out[i].Host = p
			continue
		}
		out[i].Changed = true
		if h := hostAt[i]; h >= 0 && sat[h] {
			out[i].Host = h
			delete(sat, h)
		}
	}
	for _, samePosition := range []bool{true, false} {
		for i := range out {
			if !out[i].Changed || out[i].Host >= 0 {
				continue
			}
			if h := pickSat(sat, roster, roster[out[i].Ours].Position, samePosition); h >= 0 {
				out[i].Host = h
				delete(sat, h)
			}
		}
	}
	return out
}

// pickSat is the lowest-indexed sat host starter, of the position when
// samePosition is set.
func pickSat(sat map[int]bool, roster []Candidate, position draft.Position, samePosition bool) int {
	best := -1
	for h := range sat {
		if samePosition && roster[h].Position != position {
			continue
		}
		if best < 0 || h < best {
			best = h
		}
	}
	return best
}
