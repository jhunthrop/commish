package bots

import (
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// CandidateWeight is one sampler candidate and the weight the brain gives him.
type CandidateWeight struct {
	PlayerID string
	Weight   float64
}

// Ceilings selects the roster-need ceilings the sampler draws under.
type Ceilings int

const (
	// RoomCeilings reads the room's own START_DRAFT snapshot.
	RoomCeilings Ceilings = iota
	// NoCeilings asks for the brain alone, the room's cap and deferral set aside.
	NoCeilings
)

// WeightOptions are botCandidateWeights' options.
type WeightOptions struct {
	Ceilings Ceilings
	// Observe weighs capped and waiting candidates as the bench bodies they
	// are instead of removing them: the opponent model's read of a human.
	Observe bool
}

// placed is where a candidate lands and what he is to the roster.
type placed struct {
	assignment draft.Assignment
	role       *draft.CandidateRole
	ok         bool
}

// sampler holds what one turn's draw reads, computed once per position.
type sampler struct {
	state    draft.State
	roster   []draft.RosterSlot
	slots    []draft.SlotConfig
	roleOf   draft.RoleReader
	enforce  bool
	strategy Strategy
	known    map[draft.Position]placed
}

func newSampler(s draft.State, teamID string, strategy Strategy, o WeightOptions) *sampler {
	sm := &sampler{
		state: s, roster: draft.RosterFor(s, teamID), slots: s.Config.SlotConfig,
		enforce: !o.Observe, strategy: strategy, known: make(map[draft.Position]placed, 6),
	}
	if o.Ceilings == RoomCeilings && s.Config.Autopick != nil && s.Config.Autopick.RosterCeilings != nil {
		sm.roleOf = draft.NewRoleReader(sm.roster, sm.slots, s.Pool, *s.Config.Autopick.RosterCeilings)
	}
	return sm
}

func (sm *sampler) place(p draft.Position) placed {
	if got, ok := sm.known[p]; ok {
		return got
	}
	out := placed{assignment: draft.AssignSlot(p, sm.roster, sm.slots)}
	if out.assignment.OK {
		if sm.roleOf != nil {
			role := sm.roleOf(p, out.assignment.Slot)
			out.role = &role
		}
		out.ok = out.role == nil || !sm.enforce || !out.role.Capped
	}
	sm.known[p] = out
	return out
}

// topEligible is the first ReachDepth undrafted, autopick-eligible entries
// keep accepts, in board order: nothing deeper is ever sampled.
func (sm *sampler) topEligible(drafted map[string]bool, keep func(draft.PoolEntry) bool) []draft.PoolEntry {
	out := make([]draft.PoolEntry, 0, sm.strategy.ReachDepth)
	pool := sm.state.Pool
	for i := 0; i < pool.Len() && len(out) < sm.strategy.ReachDepth; i++ {
		e := pool.At(i)
		if !drafted[e.PlayerID] && e.AutopickEligible() && keep(e) {
			out = append(out, e)
		}
	}
	return out
}

// CandidateWeights is the exact distribution ChooseBotPick draws from:
// every legal candidate in the reach window, in board order, weighted
// rankWeight x posBias x need x run for the archetype.
func CandidateWeights(s draft.State, teamID string, a Archetype, strategy Strategy, o WeightOptions) []CandidateWeight {
	sm := newSampler(s, teamID, strategy, o)
	drafted := draft.DraftedIDs(s)
	window := sm.topEligible(drafted, func(e draft.PoolEntry) bool { return sm.place(e.Position).ok })
	if len(window) == 0 {
		// The cap is a preference; a bot that returned nobody would stall a room.
		window = sm.topEligible(drafted, func(e draft.PoolEntry) bool { return sm.place(e.Position).assignment.OK })
	}
	type row struct {
		entry draft.PoolEntry
		index int
		role  *draft.CandidateRole
	}
	rows := make([]row, len(window))
	anyFree := false
	for i, e := range window {
		rows[i] = row{entry: e, index: i, role: sm.place(e.Position).role}
		if !sm.waits(rows[i].role) {
			anyFree = true
		}
	}
	recent := recentPositionCounts(s, strategy.Run.Window)
	out := make([]CandidateWeight, 0, len(rows))
	for _, r := range rows {
		if anyFree && sm.waits(r.role) {
			continue
		}
		weight := draft.RankWeight(r.index, strategy.Temperature) * a.bias(r.entry.Position)
		weight *= sm.need(r.entry.Position, r.role, a)
		weight *= runMultiplier(r.entry.Position, recent, a, strategy.Run)
		out = append(out, CandidateWeight{PlayerID: r.entry.PlayerID, Weight: weight})
	}
	return out
}

func (sm *sampler) waits(role *draft.CandidateRole) bool {
	return sm.enforce && role != nil && role.WaitsForStarters
}

// need is the brain's need term: the plain need multiplier, or under the
// ceilings warm per open starting slot and cooled per bench body.
func (sm *sampler) need(p draft.Position, role *draft.CandidateRole, a Archetype) float64 {
	st := sm.strategy
	if role == nil {
		return draft.NeedMultiplier(p, sm.roster, sm.slots, draft.NeedOptions{
			OpenSlotBoost: a.NeedWeight * st.NeedPerOpenStartingSlot,
			FilledDamp:    st.StartersFilledDamp,
		})
	}
	if role.Starts {
		return 1 + float64(a.NeedWeight*st.NeedPerOpenStartingSlot*float64(role.OpenStartingSlots))
	}
	return st.StartersFilledDamp * jsmath.PowInt(st.BenchBodyDamp, role.BenchBodies)
}

// recentPositionCounts is how many of the last window picks fell at each position.
func recentPositionCounts(s draft.State, window int) map[draft.Position]int {
	counts := map[draft.Position]int{}
	picks := s.Picks
	if len(picks) > window {
		picks = picks[len(picks)-window:]
	}
	for _, p := range picks {
		if pos, ok := s.Pool.PositionOf(p.PlayerID); ok {
			counts[pos]++
		}
	}
	return counts
}

// runMultiplier warms a position the room is running on: mildly for every
// brain, hard for the run follower.
func runMultiplier(p draft.Position, recent map[draft.Position]int, a Archetype, run RunReaction) float64 {
	if recent[p] < run.Threshold {
		return 1
	}
	if a.FollowsRuns {
		return run.NeedBoost
	}
	return run.BaseBoost
}

// weightedIndex is one draw scaled to the total, walked down the weights.
func weightedIndex(weights []CandidateWeight, rng *Rng) int {
	total := 0.0
	for _, w := range weights {
		total += w.Weight
	}
	draw := float64(rng.Next() * total)
	for i := 0; i < len(weights)-1; i++ {
		draw -= weights[i].Weight
		if draw < 0 {
			return i
		}
	}
	return len(weights) - 1
}

// legalQueuedPick is the first queued player the roster can still take.
func legalQueuedPick(s draft.State, teamID string) (string, bool) {
	if len(s.Queues[teamID]) == 0 {
		return "", false
	}
	roster := draft.RosterFor(s, teamID)
	drafted := draft.DraftedIDs(s)
	for _, e := range draft.QueuedEntries(s, teamID) {
		if e.AutopickEligible() && !drafted[e.PlayerID] && draft.AssignSlot(e.Position, roster, s.Config.SlotConfig).OK {
			return e.PlayerID, true
		}
	}
	return "", false
}

// ChooseBotPick is the bot brain: a legal queued player first, else one
// draw from the sampler's weights, which consumes exactly one value of
// rng. False when the roster can take nothing that remains.
func ChooseBotPick(s draft.State, teamID string, a Archetype, strategy Strategy, rng *Rng) (string, bool) {
	if queued, ok := legalQueuedPick(s, teamID); ok {
		return queued, true
	}
	weights := CandidateWeights(s, teamID, a, strategy, WeightOptions{})
	if len(weights) == 0 {
		return "", false
	}
	return weights[weightedIndex(weights, rng)].PlayerID, true
}
