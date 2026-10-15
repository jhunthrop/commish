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
	Tier       Tier
	// Locked is a player whose game has kicked off: he cannot be moved
	// into or out of the lineup.
	Locked bool
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

// withinBetter is §4.2's order inside one position: tier, then our
// position order, then points over replacement, then points a game.
func withinBetter(a, b *Candidate) bool {
	if a.Tier != b.Tier {
		return a.Tier < b.Tier
	}
	if (a.Rank == 0) != (b.Rank == 0) {
		return a.Rank != 0
	}
	if a.Rank != b.Rank {
		return a.Rank < b.Rank
	}
	return valueThenForm(a, b)
}

// acrossBetter orders players of different positions for a shared slot:
// a position rank says nothing about another position, so after the
// tier the points over replacement decide, then the rank, then the form.
func acrossBetter(a, b *Candidate) bool {
	if a.Tier != b.Tier {
		return a.Tier < b.Tier
	}
	if a.HasValue != b.HasValue {
		return a.HasValue
	}
	if a.HasValue && a.Value != b.Value {
		return a.Value > b.Value
	}
	if a.Position == b.Position {
		return withinBetter(a, b)
	}
	return valueThenForm(a, b)
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

// fill puts the best of pool in every open slot: each position's own
// slots first, in config order, by the order inside the position; then
// the shared slots, narrowest first, by the order across positions.
// taken marks players already placed; the answer is a pool index per
// slot, -1 where nobody eligible is left.
func fill(slots []Slot, open []bool, pool []Candidate, taken []bool) []int {
	out := make([]int, len(slots))
	for i := range out {
		out[i] = -1
	}
	order := make([]int, len(pool))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool { return withinBetter(&pool[order[i]], &pool[order[j]]) })
	for i, s := range slots {
		if !open[i] || s.shared() {
			continue
		}
		for _, p := range order {
			if !taken[p] && s.accepts(pool[p].Position) {
				out[i], taken[p] = p, true
				break
			}
		}
	}
	shared := make([]int, 0, len(slots))
	for i, s := range slots {
		if open[i] && s.shared() {
			shared = append(shared, i)
		}
	}
	sort.SliceStable(shared, func(i, j int) bool { return len(slots[shared[i]].Eligible) < len(slots[shared[j]].Eligible) })
	for _, i := range shared {
		best := -1
		for p := range pool {
			if taken[p] || !slots[i].accepts(pool[p].Position) {
				continue
			}
			if best < 0 || acrossBetter(&pool[p], &pool[best]) {
				best = p
			}
		}
		if best >= 0 {
			out[i], taken[best] = best, true
		}
	}
	return out
}

// Row is one starting spot of the advised lineup: who we start, and who
// the host has there (-1 when the spot is empty on the host). Changed
// is a player we start whom the host has on the bench.
type Row struct {
	Slot    Slot
	Ours    int
	Host    int
	Changed bool
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
		if c.Locked && !hostStarts[p] {
			taken[p] = true
		}
	}
	for i, p := range fill(slots, open, roster, taken) {
		if open[i] {
			ours[i] = p
		}
	}
	labelled := keepHostSpots(slots, roster, ours, hostAt)
	return rows(slots, labelled, hostAt, hostStarts, roster)
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
