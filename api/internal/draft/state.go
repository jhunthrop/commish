package draft

import "sync/atomic"

// Pick is one completed pick.
type Pick struct {
	// PickNumber is the global 1-based pick (snake) or lot number (auction).
	PickNumber int `json:"pickNumber"`
	// Round is the serpentine round (snake) or the team's won count + 1 (auction).
	Round     int      `json:"round"`
	TeamID    string   `json:"teamId"`
	PlayerID  string   `json:"playerId"`
	Slot      SlotType `json:"slot"`
	SlotIndex int      `json:"slotIndex"`
	// Price is the winning bid for an auction pick, nil for a snake pick.
	Price     *int   `json:"price"`
	Timestamp string `json:"timestamp"`
	// Auto is true when the clock made this pick, not a human.
	Auto bool `json:"auto"`
}

// AuctionLot is the player up for bid.
type AuctionLot struct {
	PlayerID          string `json:"playerId"`
	HighBid           int    `json:"highBid"`
	HighBidTeamID     string `json:"highBidTeamId"`
	NominatedByTeamID string `json:"nominatedByTeamId"`
	AutoNominated     bool   `json:"autoNominated"`
}

// AuctionState is the auction sub-state.
type AuctionState struct {
	// NominatingTeamID is the team due to nominate, nil once every roster is full.
	NominatingTeamID *string     `json:"nominatingTeamId"`
	Lot              *AuctionLot `json:"lot"`
	// MinBid is the opening price for auto-nominated lots, from START_DRAFT.
	MinBid int `json:"minBid"`
}

// State is the whole draft, rebuilt by replaying its log. Every field is
// shared between states and never written after a state is returned: a
// reducer copies what it changes.
type State struct {
	Config     Config   `json:"config"`
	Phase      Phase    `json:"phase"`
	Sequence   int      `json:"sequence"`
	DraftOrder []string `json:"draftOrder"`
	Pool       Pool     `json:"pool"`
	Picks      []Pick   `json:"picks"`
	// Rosters is team id to filled slots; an empty slot is absent.
	Rosters map[string][]RosterSlot `json:"rosters"`
	// Budgets is team id to remaining auction dollars; empty for snake.
	Budgets map[string]int `json:"budgets"`
	// Queues is team id to that team's ranked autopick queue.
	Queues map[string][]string `json:"queues"`
	// OwedPicks is team id to the pick numbers it was skipped at, in the
	// order owed. A key never maps to an empty list.
	OwedPicks map[string][]int `json:"owedPicks"`
	Auction   *AuctionState    `json:"auction"`
	// PickNumber is the pick about to be made (snake) or the lot about to
	// be awarded (auction).
	PickNumber int `json:"pickNumber"`
	// TurnStartedAt is when the current clock window started, nil when no
	// turn is running.
	TurnStartedAt *string `json:"turnStartedAt"`

	// tail is the claim on Picks' spare capacity (see appendPick).
	tail *pickTail
}

// Initial is the state before START_DRAFT.
func Initial(config Config) State {
	return State{
		Config:     config,
		Phase:      PhaseScheduled,
		DraftOrder: []string{},
		Pool:       NewPool(nil),
		Picks:      []Pick{},
		Rosters:    map[string][]RosterSlot{},
		Budgets:    map[string]int{},
		Queues:     map[string][]string{},
		OwedPicks:  map[string][]int{},
	}
}

// TotalRosterSlots is the roster size, which is a snake draft's round count.
func TotalRosterSlots(slots []SlotConfig) int {
	sum := 0
	for _, s := range slots {
		sum += s.Count
	}
	return sum
}

// TotalPickCount is every pick a snake draft makes.
func TotalPickCount(s State) int {
	return len(s.DraftOrder) * TotalRosterSlots(s.Config.SlotConfig)
}

// RosterFor is one team's filled slots.
func RosterFor(s State, teamID string) []RosterSlot { return s.Rosters[teamID] }

// AuctionOf is the auction sub-state, nil for a snake draft.
func AuctionOf(s State) *AuctionState {
	if s.Config.Format != Auction {
		return nil
	}
	return s.Auction
}

// WithPool is s seen through another board: the same draft, a different
// preference order or a narrower set (a seat's own board, a shortlist held
// back). Used by the bots and the sim, never by the reducer.
func (s State) WithPool(p Pool) State {
	s.Pool = p
	return s
}

func stringPtr(v string) *string { return &v }

// pickTail is the shared claim on one picks array's spare capacity.
type pickTail struct {
	base    *Pick
	claimed atomic.Int64
}

// appendPick is s.Picks plus one without disturbing any other state. A
// draft appends a pick per action, and copying the whole list each time is
// quadratic over a draft and over every simulated run, so a states' picks
// share one array with spare capacity: the first state to extend it at its
// own length claims the next element atomically and writes it in place;
// any other state extending at the same length (a branch: an undo, two
// runs from one room) loses the claim and copies. No state ever sees an
// element past its own length, so a shared array is never observed to
// change. Callers treat Picks as read-only.
func appendPick(s State, p Pick) ([]Pick, *pickTail) {
	n := len(s.Picks)
	if t := s.tail; t != nil && cap(s.Picks) > n && &s.Picks[:cap(s.Picks)][0] == t.base && t.claimed.CompareAndSwap(int64(n), int64(n+1)) {
		out := s.Picks[:n+1]
		out[n] = p
		return out, t
	}
	out := make([]Pick, n+1, max(16, 2*n+1))
	copy(out, s.Picks)
	out[n] = p
	t := &pickTail{base: &out[0]}
	t.claimed.Store(int64(n + 1))
	return out, t
}

// withRoster is rosters with one team's slots replaced, in a new map.
func withRoster(rosters map[string][]RosterSlot, teamID string, slots []RosterSlot) map[string][]RosterSlot {
	out := make(map[string][]RosterSlot, len(rosters)+1)
	for k, v := range rosters {
		out[k] = v
	}
	out[teamID] = slots
	return out
}
