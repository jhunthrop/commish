package draft

import (
	"math"

	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// placement memoizes AssignSlot by position for one roster: where a
// candidate lands depends on his position alone.
type placement struct {
	roster []RosterSlot
	slots  []SlotConfig
	known  [PositionCount]Assignment
	has    [PositionCount]bool
}

func newPlacement(roster []RosterSlot, slots []SlotConfig) *placement {
	return &placement{roster: roster, slots: slots}
}

func (p *placement) of(pos Position) Assignment {
	i := pos.Index()
	if i < 0 {
		return AssignSlot(pos, p.roster, p.slots)
	}
	if !p.has[i] {
		p.known[i], p.has[i] = AssignSlot(pos, p.roster, p.slots), true
	}
	return p.known[i]
}

// autopickContext is what both autopick selectors share: the board with
// what is drafted marked, and the first legal queued player.
type autopickContext struct {
	pool   Pool
	taken  Taken
	roster []RosterSlot
	place  *placement
	queued *PoolEntry
}

func newAutopickContext(s State, teamID string) autopickContext {
	roster := RosterFor(s, teamID)
	ctx := autopickContext{pool: s.Pool, taken: TakenOn(s), roster: roster, place: newPlacement(roster, s.Config.SlotConfig)}
	for _, e := range QueuedEntries(s, teamID) {
		if !ctx.taken.Has(e.PlayerID) && e.AutopickEligible() && ctx.place.of(e.Position).OK {
			queued := e
			ctx.queued = &queued
			break
		}
	}
	return ctx
}

// available is whether board index i is undrafted and the room's to take.
func (c autopickContext) available(i int) bool {
	return !c.taken.At(i) && c.pool.At(i).AutopickEligible()
}

func (c autopickContext) firstLegal() (PoolEntry, bool) {
	for i := 0; i < c.pool.Len(); i++ {
		if e := c.pool.At(i); c.available(i) && c.place.of(e.Position).OK {
			return e, true
		}
	}
	return PoolEntry{}, false
}

// bucket is where a legal candidate sits for the argmax: now competes,
// deferred only when nothing competes, capped only when nothing else is legal.
type bucket int

const (
	bucketNow bucket = iota
	bucketDeferred
	bucketCapped
)

type candidateNeed struct {
	need   float64
	bucket bucket
}

// BestAvailableFor is the clock's autopick: the team's first legal queued
// player, else a deterministic argmax of rankWeight(legal index) times the
// need term under the draft's own snapshot. No snapshot means the
// pre-upgrade policy, plain board order. Ties keep the earlier index.
func BestAvailableFor(s State, teamID string) (PoolEntry, bool) {
	ctx := newAutopickContext(s, teamID)
	if ctx.queued != nil {
		return *ctx.queued, true
	}
	policy := s.Config.Autopick
	if policy == nil {
		return ctx.firstLegal()
	}
	ramp := needRamp(len(ctx.roster), s, *policy)
	var score func(Position, SlotType) candidateNeed
	if policy.RosterCeilings == nil {
		score = surplusDampScorer(s, ctx.roster, *policy, ramp)
	} else {
		score = rosterCeilingScorer(s, ctx.roster, *policy, ramp)
	}
	var needs [PositionCount]candidateNeed
	var scored [PositionCount]bool
	type best struct {
		entry PoolEntry
		score float64
		found bool
	}
	var top [3]best
	for b := range top {
		top[b].score = math.Inf(-1)
	}
	legalIndex := 0
	for i := 0; i < ctx.pool.Len(); i++ {
		if !ctx.available(i) {
			continue
		}
		e := ctx.pool.At(i)
		a := ctx.place.of(e.Position)
		if !a.OK {
			continue
		}
		var n candidateNeed
		if i := e.Position.Index(); i >= 0 && scored[i] {
			n = needs[i]
		} else {
			n = score(e.Position, a.Slot)
			if i >= 0 {
				needs[i], scored[i] = n, true
			}
		}
		value := RankWeight(legalIndex, policy.Temperature) * n.need
		legalIndex++
		if value > top[n.bucket].score {
			top[n.bucket] = best{entry: e, score: value, found: true}
		}
	}
	for _, b := range top {
		if b.found {
			return b.entry, true
		}
	}
	return PoolEntry{}, false
}

// needRamp is 0 on a team's first pick, rising linearly to 1 once its own
// roster is RampFullAtRosterFraction full.
func needRamp(rosterLength int, s State, policy AutopickPolicy) float64 {
	fullAt := policy.RampFullAtRosterFraction * float64(TotalRosterSlots(s.Config.SlotConfig))
	if fullAt <= 0 {
		return 0
	}
	return math.Min(1, float64(rosterLength)/fullAt)
}

// ramped is 1 - ramp * (1 - damp), rounded as the TypeScript rounds it.
func ramped(ramp, damp float64) float64 { return 1 - float64(ramp*(1-damp)) }

// surplusDampScorer is the 2026-09-03 to 2026-09-11 scoring, kept byte for
// byte for the logs made under it.
func surplusDampScorer(s State, roster []RosterSlot, policy AutopickPolicy, ramp float64) func(Position, SlotType) candidateNeed {
	base := NeedOptions{OpenSlotBoost: ramp * policy.NeedPerOpenStartingSlot, FilledDamp: ramped(ramp, policy.StartersFilledDamp)}
	var counts map[Position]int
	if policy.SurplusDamp != nil {
		damp := ramped(ramp, *policy.SurplusDamp)
		base.SurplusDamp = &damp
		counts = countByPosition(roster, s.Pool, false)
	}
	slots := s.Config.SlotConfig
	return func(p Position, _ SlotType) candidateNeed {
		opts := base
		if counts != nil {
			n := counts[p]
			opts.RosteredAtPosition = &n
		}
		b := bucketNow
		if deferredLateRound(p, roster, slots, policy.LateRoundOnlyRoundsFromEnd) {
			b = bucketDeferred
		}
		return candidateNeed{need: NeedMultiplier(p, roster, slots, opts), bucket: b}
	}
}

// rosterCeilingScorer is the 2026-09-12 scoring under the ceilings.
func rosterCeilingScorer(s State, roster []RosterSlot, policy AutopickPolicy, ramp float64) func(Position, SlotType) candidateNeed {
	slots := s.Config.SlotConfig
	openSlotBoost := ramp * policy.NeedPerOpenStartingSlot
	benchDamp := ramped(ramp, policy.StartersFilledDamp)
	surplus := 1.0
	if policy.SurplusDamp != nil {
		surplus = *policy.SurplusDamp
	}
	depthDamp := ramped(ramp, surplus)
	roleOf := NewRoleReader(roster, slots, s.Pool, *policy.RosterCeilings)
	return func(p Position, landsIn SlotType) candidateNeed {
		role := roleOf(p, landsIn)
		var need float64
		if role.Starts {
			need = 1 + float64(openSlotBoost*float64(role.OpenStartingSlots))
		} else {
			need = benchDamp * jsmath.PowInt(depthDamp, role.BenchBodies)
		}
		if role.Capped {
			return candidateNeed{need: need, bucket: bucketCapped}
		}
		if role.WaitsForStarters || deferredLateRound(p, roster, slots, policy.LateRoundOnlyRoundsFromEnd) {
			return candidateNeed{need: need, bucket: bucketDeferred}
		}
		return candidateNeed{need: need, bucket: bucketNow}
	}
}

// BestNominationFor is the auction's auto-nomination: the queue first,
// then plain board order, need-blind on purpose.
func BestNominationFor(s State, teamID string) (PoolEntry, bool) {
	ctx := newAutopickContext(s, teamID)
	if ctx.queued != nil {
		return *ctx.queued, true
	}
	return ctx.firstLegal()
}
