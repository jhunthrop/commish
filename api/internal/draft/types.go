// Package draft is the draft engine: one pure reducer over an action log,
// ported from src/draft-engine so the solo room, the lobby and the report
// share it. No clock and no I/O: every action carries its own timestamp,
// and Reduce returns a new State without touching the one it was given.
//
// The rule every guard follows (reduce.ts): a reducer guard reads only the
// action log and prior state, never a tunable a deploy could change. A
// tunable belongs in Admit, which runs at command time and never on
// replay.
package draft

import (
	"encoding/json"
	"fmt"
)

// Position is a player's position.
type Position string

// The positions a pool carries.
const (
	QB  Position = "QB"
	RB  Position = "RB"
	WR  Position = "WR"
	TE  Position = "TE"
	K   Position = "K"
	DEF Position = "DEF"
)

// PositionCount is the number of positions, the size of a per-position table.
const PositionCount = 6

// Index is p's place in a per-position table: QB, RB, WR, TE, K, DEF.
// An unknown position (never in a validated pool) is -1.
func (p Position) Index() int {
	switch p {
	case QB:
		return 0
	case RB:
		return 1
	case WR:
		return 2
	case TE:
		return 3
	case K:
		return 4
	case DEF:
		return 5
	}
	return -1
}

// Valid reports whether p is one of the six positions.
func (p Position) Valid() bool {
	switch p {
	case QB, RB, WR, TE, K, DEF:
		return true
	}
	return false
}

// SlotType names a roster slot.
type SlotType string

// The slot types a roster shape is built from.
const (
	SlotQB        SlotType = "QB"
	SlotRB        SlotType = "RB"
	SlotWR        SlotType = "WR"
	SlotTE        SlotType = "TE"
	SlotFlex      SlotType = "FLEX"
	SlotSuperflex SlotType = "SUPERFLEX"
	SlotK         SlotType = "K"
	SlotDEF       SlotType = "DEF"
	SlotBench     SlotType = "BENCH"
)

// SlotConfig is one row of a league's roster shape.
type SlotConfig struct {
	Slot              SlotType   `json:"slot"`
	Count             int        `json:"count"`
	EligiblePositions []Position `json:"eligiblePositions"`
}

func (c SlotConfig) accepts(p Position) bool {
	for _, e := range c.EligiblePositions {
		if e == p {
			return true
		}
	}
	return false
}

// RosterSlot is one filled roster spot.
type RosterSlot struct {
	Slot      SlotType `json:"slot"`
	SlotIndex int      `json:"slotIndex"`
	PlayerID  string   `json:"playerId"`
}

// PoolEntry is one draftable player as the draft saw him.
type PoolEntry struct {
	PlayerID string   `json:"playerId"`
	Position Position `json:"position"`
	// ExcludedFromAutopick marks a player the served board had off an
	// active roster at START_DRAFT: the clock and the bots never take him.
	ExcludedFromAutopick bool `json:"excludedFromAutopick,omitempty"`
}

// AutopickEligible is whether the room's own hand may take this player.
func (e PoolEntry) AutopickEligible() bool { return !e.ExcludedFromAutopick }

// Pool is the draftable pool in ranking order, best first, with an index
// by player id built once. A Pool is never modified after NewPool; a
// filtered or reordered board is a new Pool.
type Pool struct {
	entries []PoolEntry
	index   map[string]int
}

// NewPool indexes entries. Duplicate ids keep their first position, the
// answer Array.prototype.find gives; START_DRAFT refuses a pool with any.
func NewPool(entries []PoolEntry) Pool {
	own := append([]PoolEntry(nil), entries...)
	index := make(map[string]int, len(own))
	for i, e := range own {
		if _, seen := index[e.PlayerID]; !seen {
			index[e.PlayerID] = i
		}
	}
	return Pool{entries: own, index: index}
}

// Len is the pool size.
func (p Pool) Len() int { return len(p.entries) }

// At is the entry at board index i.
func (p Pool) At(i int) PoolEntry { return p.entries[i] }

// Entries is a copy of the board.
func (p Pool) Entries() []PoolEntry { return append([]PoolEntry(nil), p.entries...) }

// Lookup finds a player and his board index.
func (p Pool) Lookup(playerID string) (PoolEntry, int, bool) {
	i, ok := p.index[playerID]
	if !ok {
		return PoolEntry{}, -1, false
	}
	return p.entries[i], i, true
}

// PositionOf is a pooled player's position.
func (p Pool) PositionOf(playerID string) (Position, bool) {
	i, ok := p.index[playerID]
	if !ok {
		return "", false
	}
	return p.entries[i].Position, true
}

// Filter is a new Pool of the entries keep accepts, in board order.
func (p Pool) Filter(keep func(PoolEntry) bool) Pool {
	out := make([]PoolEntry, 0, len(p.entries))
	for _, e := range p.entries {
		if keep(e) {
			out = append(out, e)
		}
	}
	return NewPool(out)
}

// MarshalJSON writes the pool as its array of entries.
func (p Pool) MarshalJSON() ([]byte, error) {
	if p.entries == nil {
		return []byte("[]"), nil
	}
	return json.Marshal(p.entries)
}

// UnmarshalJSON reads an array of entries.
func (p *Pool) UnmarshalJSON(raw []byte) error {
	var entries []PoolEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return fmt.Errorf("draft: pool: %w", err)
	}
	*p = NewPool(entries)
	return nil
}

// Phase is where the draft is.
type Phase string

// The phases the reducer moves through.
const (
	PhaseScheduled  Phase = "scheduled"
	PhaseInProgress Phase = "in_progress"
	PhaseComplete   Phase = "complete"
)

// Format is snake or auction.
type Format string

// The two formats.
const (
	Snake   Format = "snake"
	Auction Format = "auction"
)
