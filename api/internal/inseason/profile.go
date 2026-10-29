package inseason

import (
	"maps"
	"math/bits"
	"slices"
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// A team's profile (Lane 287): what its best lineup scores at each
// starting slot over the weeks left, week by week with each club's bye,
// against the league's median team at the same slot. Its needs are the
// slots furthest below that median; its surplus the bench players who
// would start for the median team. The trade finder reads both sides'.

// scheduleRead marks Candidate.Plays as read: bit 0 is never a week, so
// a read schedule with no game left (Plays == scheduleRead) is told from
// an unread one (0, every week).
const scheduleRead uint32 = 1

// PlaysIn is the Plays mark of a club whose games fall in weeks.
func PlaysIn(weeks []int) uint32 {
	mark := scheduleRead
	for _, w := range weeks {
		if w > 0 && w < 32 {
			mark |= 1 << w
		}
	}
	return mark
}

// Span is the weeks the order's rest of season covers, first through
// last.
type Span struct{ First, Last int }

// SpanOf is the span of weeks ending at last.
func SpanOf(weeks, last int) Span { return Span{First: last - max(1, weeks) + 1, Last: last} }

// Weeks is how many weeks the span covers, never fewer than one.
func (s Span) Weeks() int { return max(1, s.Last-s.First+1) }

// mask is the span's weeks as a Plays mark.
func (s Span) mask() uint32 {
	var m uint32
	for w := max(1, s.First); w <= s.Last && w < 32; w++ {
		m |= 1 << w
	}
	return m
}

// plays is whether c's club has a game in week: every week when its
// schedule is not read.
func plays(c *Candidate, week int) bool {
	return c.Plays == 0 || c.Plays&(1<<week) != 0
}

// games is how many of the span's weeks c's club plays.
func (s Span) games(c *Candidate) int {
	if c.Plays == 0 {
		return s.Weeks()
	}
	return bits.OnesCount32(c.Plays & s.mask())
}

// perGame is c's rest-of-season points over replacement a game: his
// total over his club's games left, none without a figure or a game.
func (s Span) perGame(c *Candidate) float64 {
	n := s.games(c)
	if !c.HasValue || n == 0 {
		return 0
	}
	return c.Value / float64(n)
}

// pointsPerGame is c's rest-of-season points a game (Lane 291), none
// without a figure or a game.
func (s Span) pointsPerGame(c *Candidate) float64 {
	n := s.games(c)
	if !c.HasPoints || n == 0 {
		return 0
	}
	return c.Points / float64(n)
}

// weekFill is the best lineup week by week over a span, filled as the
// Lineup screen fills it (each position's own slots first, then the
// shared slots narrowest first) from the players whose clubs play that
// week, ordered by their points a game. A slot nobody fills counts the
// waiver level a week at its best position (free, points over
// replacement over the span): the player its team would pick up. Its
// buffers are kept between calls.
type weekFill struct {
	slots  []Slot
	shared []int
	span   Span
	free   map[draft.Position]float64
	rate   []float64
	order  []int
	taken  []bool
	points []float64
	// sets, times and firsts are slotPoints' weeks grouped by who plays:
	// each set of players, how many weeks it holds, its first week.
	sets   []uint64
	times  []int
	firsts []int
	// byPosition is, when set, the rest-of-season points the fill's
	// starters score over the span by their position (Lane 291): a shared
	// slot counts for the position of the player who fills it, an empty
	// slot for none.
	byPosition map[draft.Position]float64
}

func newWeekFill(slots []Slot, span Span, free map[draft.Position]float64) *weekFill {
	return &weekFill{slots: slots, shared: sharedOrder(slots), span: span, free: free, points: make([]float64, len(slots))}
}

// slotPoints is each slot's points over the span from pool, in a buffer
// good until the next call.
func (w *weekFill) slotPoints(pool []*Candidate) []float64 {
	w.prepare(pool)
	for i := range w.points {
		w.points[i] = 0
	}
	if w.byPosition != nil {
		clear(w.byPosition)
	}
	// Weeks whose players who play are the same fill the same: each such
	// set is filled once and counted for each of its weeks.
	w.sets, w.times = w.sets[:0], w.times[:0]
	for week := w.span.First; week <= w.span.Last; week++ {
		set, ok := playingSet(pool, week)
		if !ok {
			w.fillWeek(pool, week, 1)
			continue
		}
		if at := slices.Index(w.sets, set); at >= 0 {
			w.times[at]++
			continue
		}
		w.sets, w.times, w.firsts = append(w.sets, set), append(w.times, 1), append(w.firsts[:len(w.sets)], week)
	}
	for i, week := range w.firsts[:len(w.sets)] {
		w.fillWeek(pool, week, float64(w.times[i]))
	}
	return w.points
}

// playingSet is the players of pool whose clubs play week, as bits; false
// for a pool too large to mark.
func playingSet(pool []*Candidate, week int) (uint64, bool) {
	if len(pool) > 64 {
		return 0, false
	}
	var set uint64
	for i, c := range pool {
		if plays(c, week) {
			set |= 1 << i
		}
	}
	return set, true
}

// perWeek is the lineup's points over replacement a week over the span:
// the trade finder's lineup strength (Lane 287).
func (w *weekFill) perWeek(pool []*Candidate) float64 {
	total := 0.0
	for _, p := range w.slotPoints(pool) {
		total += p
	}
	return PerWeek(total, w.span.Weeks())
}

// prepare orders pool by points a game, best first.
func (w *weekFill) prepare(pool []*Candidate) {
	w.rate, w.order = w.rate[:0], w.order[:0]
	for i, c := range pool {
		w.rate = append(w.rate, w.span.perGame(c))
		w.order = append(w.order, i)
	}
	order := w.order
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && w.better(pool, order[j], order[j-1]); j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
}

func (w *weekFill) better(pool []*Candidate, a, b int) bool {
	if w.rate[a] != w.rate[b] {
		return w.rate[a] > w.rate[b]
	}
	return pool[a].ID < pool[b].ID
}

// fillWeek adds one week's fill to points, times over.
func (w *weekFill) fillWeek(pool []*Candidate, week int, times float64) {
	w.taken = w.taken[:0]
	for _, c := range pool {
		w.taken = append(w.taken, c.InjuredReserve || !plays(c, week))
	}
	for i, s := range w.slots {
		if !s.shared() {
			w.count(pool, i, times)
		}
	}
	for _, i := range w.shared {
		w.count(pool, i, times)
	}
}

// count adds slot i's take to its points, times over, and to its
// starter's position when the fill keeps them.
func (w *weekFill) count(pool []*Candidate, i int, times float64) {
	rate, at := w.take(pool, w.slots[i])
	w.points[i] += times * rate
	if at >= 0 && w.byPosition != nil {
		c := pool[at]
		w.byPosition[c.Position] += times * w.span.pointsPerGame(c)
	}
}

// take is the points a game of the best player left for s, marked
// taken, with his index into pool, or the slot's waiver level a week
// and -1 when none is left.
func (w *weekFill) take(pool []*Candidate, s Slot) (float64, int) {
	for _, p := range w.order {
		if !w.taken[p] && s.accepts(pool[p].Position) {
			w.taken[p] = true
			return w.rate[p], p
		}
	}
	return w.waiverLevel(s), -1
}

// waiverLevel is the best waiver level a week among s's positions, 0 (the
// last starter's) with none read.
func (w *weekFill) waiverLevel(s Slot) float64 {
	best, found := 0.0, false
	for _, p := range s.Eligible {
		if v, ok := w.free[p]; ok && (!found || v > best) {
			best, found = v, true
		}
	}
	return PerWeek(best, w.span.Weeks())
}

// TeamProfile is one roster's profile: each starting slot's points over
// replacement over the span (Slots, an index into the league's Slots),
// and its bench's by position: the players its lineup with everyone
// playing leaves out.
type TeamProfile struct {
	Slots []float64
	Bench map[draft.Position]float64
}

// Need is a starting slot of a team's that falls short of the league's
// median team there: Slot an index into Slots, Short the points over the
// span it falls short by.
type Need struct {
	Slot  int
	Short float64
}

// TradeLeague is the league as the trade finder reads it (Lane 287): its
// lineup, the weeks its order covers, each position's waiver level over
// them and the median team's points at each starting slot.
type TradeLeague struct {
	Config []draft.SlotConfig
	Span   Span
	Free   map[draft.Position]float64
	Median []float64
	// Positions is each roster's rest-of-season points by position from
	// the same fill, in the order the rosters were given (Lane 291): the
	// starters its best lineup fields there, week by week.
	Positions []map[draft.Position]float64
	slots     []Slot
}

// Weeks is how many weeks the league's figures cover.
func (l TradeLeague) Weeks() int { return l.Span.Weeks() }

// NewTradeLeague profiles every roster of the league and keeps the median
// at each slot. The waiver levels are read off the players (each carries
// his position's, Candidate.FreeLevel).
func NewTradeLeague(config []draft.SlotConfig, span Span, squads []Squad) TradeLeague {
	l := TradeLeague{Config: config, Span: span, Free: freeOf(squads), slots: Slots(config)}
	fill := l.fill()
	fill.byPosition = map[draft.Position]float64{}
	columns := make([][]float64, len(l.slots))
	for _, s := range squads {
		for i, p := range fill.slotPoints(pointers(s.Players)) {
			columns[i] = append(columns[i], p)
		}
		l.Positions = append(l.Positions, maps.Clone(fill.byPosition))
	}
	l.Median = make([]float64, len(l.slots))
	for i, c := range columns {
		l.Median[i] = median(c)
	}
	return l
}

func (l TradeLeague) fill() *weekFill { return newWeekFill(l.slots, l.Span, l.Free) }

// freeOf is each position's waiver level, as its players carry it.
func freeOf(squads []Squad) map[draft.Position]float64 {
	out := map[draft.Position]float64{}
	for _, s := range squads {
		for _, c := range s.Players {
			out[c.Position] = c.FreeLevel
		}
	}
	return out
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// Profile is a roster's profile in the league.
func (l TradeLeague) Profile(players []Candidate) TeamProfile {
	pool := pointers(players)
	out := TeamProfile{Slots: append([]float64(nil), l.fill().slotPoints(pool)...), Bench: map[draft.Position]float64{}}
	for i, starts := range l.starting(pool) {
		if c := pool[i]; !starts && c.HasValue && skill(c.Position) {
			out.Bench[c.Position] += c.Value
		}
	}
	return out
}

// Starting marks the players of a roster the lineup with everyone
// playing starts (the profile's bench is the rest).
func (l TradeLeague) Starting(players []Candidate) []bool { return l.starting(pointers(players)) }

// starting marks the players the lineup with everyone playing starts:
// the fill of a week every club plays.
func (l TradeLeague) starting(pool []*Candidate) []bool {
	f := l.fill()
	f.prepare(pool)
	f.taken = f.taken[:0]
	for _, c := range pool {
		f.taken = append(f.taken, c.InjuredReserve)
	}
	bench := make([]bool, len(pool))
	copy(bench, f.taken)
	for _, s := range f.slots {
		if !s.shared() {
			f.take(pool, s)
		}
	}
	for _, i := range f.shared {
		f.take(pool, f.slots[i])
	}
	out := make([]bool, len(pool))
	for i := range pool {
		out[i] = f.taken[i] && !bench[i]
	}
	return out
}

// Needs is the profile's starting slots at the skill positions that fall
// below the league's median by CloseCall a week or more, the furthest
// below first: a smaller gap is inside our order's own spread.
func (l TradeLeague) Needs(p TeamProfile) []Need {
	least := CloseCall * float64(l.Weeks())
	var out []Need
	for i, s := range l.slots {
		if !skillSlot(s) {
			continue
		}
		if short := l.Median[i] - p.Slots[i]; roundTenth(short) >= least {
			out = append(out, Need{Slot: i, Short: short})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Short > out[b].Short })
	return out
}

// Surplus is the bench players of a roster who would start for the
// league's median team at their position: their rest of season over the
// median's at the least of the slots that take them, as a page prints
// each (a tie starts no one). Indexes into players.
func (l TradeLeague) Surplus(players []Candidate) []int {
	pool := pointers(players)
	var out []int
	for i, starts := range l.starting(pool) {
		c := pool[i]
		if starts || c.InjuredReserve || !c.HasValue || !skill(c.Position) {
			continue
		}
		if bar, ok := l.startsFor(c.Position); ok && roundTenth(c.Value) > roundTenth(bar) {
			out = append(out, i)
		}
	}
	return out
}

// startsFor is the median team's least starter at a position: the
// smallest median among the slots that take it.
func (l TradeLeague) startsFor(p draft.Position) (float64, bool) {
	bar, found := 0.0, false
	for i, s := range l.slots {
		if s.accepts(p) && (!found || l.Median[i] < bar) {
			bar, found = l.Median[i], true
		}
	}
	return bar, found
}

// skillSlot is a starting slot that takes a skill position.
func skillSlot(s Slot) bool {
	for _, p := range s.Eligible {
		if skill(p) {
			return true
		}
	}
	return false
}

// FillShare is the share of a need's shortfall a trade must make up to
// fill it; a need also takes at least CloseCall a week, so a rounding
// shift is no fill.
const FillShare = 0.5

// filled is the first of needs whose slot rises by enough from before to
// after (indexes into Slots), -1 for none.
func (l TradeLeague) filled(needs []Need, before, after []float64) int {
	least := CloseCall * float64(l.Weeks())
	for _, n := range needs {
		if roundTenth(after[n.Slot]-before[n.Slot]) >= roundTenth(max(least, FillShare*n.Short)) {
			return n.Slot
		}
	}
	return -1
}
