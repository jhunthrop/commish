package bots

import "github.com/jhunthrop/commish/api/internal/draft"

// Archetype is one bot brain: weight tweaks over the one shared sampler.
type Archetype struct {
	Name string `json:"name"`
	// NeedWeight scales how hard open starting slots pull this brain.
	NeedWeight float64 `json:"needWeight"`
	// PosBias multiplies a position's weight; absent means 1.
	PosBias map[draft.Position]float64 `json:"posBias"`
	// FollowsRuns is the one brain that panics with the room.
	FollowsRuns bool `json:"followsRuns,omitempty"`
}

func (a Archetype) bias(p draft.Position) float64 {
	if b, ok := a.PosBias[p]; ok {
		return b
	}
	return 1
}

// Archetypes is the deck, in its order (src/mock-draft/archetypes.ts).
func Archetypes() []Archetype {
	return []Archetype{
		{Name: "best_available", NeedWeight: 1.0, PosBias: map[draft.Position]float64{}},
		{Name: "rb_heavy", NeedWeight: 1.0, PosBias: map[draft.Position]float64{draft.RB: 1.6}},
		{Name: "zero_rb", NeedWeight: 1.0, PosBias: map[draft.Position]float64{draft.RB: 0.4, draft.WR: 1.5}},
		{Name: "qb_early", NeedWeight: 1.0, PosBias: map[draft.Position]float64{draft.QB: 1.8}},
		{Name: "te_premium", NeedWeight: 1.0, PosBias: map[draft.Position]float64{draft.TE: 1.7}},
		{Name: "need_filler", NeedWeight: 2.0, PosBias: map[draft.Position]float64{}},
		{Name: "run_follower", NeedWeight: 1.0, PosBias: map[draft.Position]float64{}, FollowsRuns: true},
	}
}

// Neutral is the best_available brain, the prior every unread seat holds.
func Neutral() Archetype { return Archetypes()[0] }

// archetypeStreamKey is load-bearing for replay: renaming it re-deals
// every seeded room.
const archetypeStreamKey = "archetypes"

// AssignArchetypes deals the deck, shuffled from the draft seed's
// "archetypes" stream, round-robin over the bot seats.
func AssignArchetypes(seed uint32, botTeamIDs []string) map[string]Archetype {
	deck := Shuffle(Archetypes(), RngFor(seed, archetypeStreamKey))
	out := make(map[string]Archetype, len(botTeamIDs))
	for i, team := range botTeamIDs {
		out[team] = deck[i%len(deck)]
	}
	return out
}
