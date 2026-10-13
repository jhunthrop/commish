// Package mock is the solo mock as a function (docs/design/2026-10-12-
// mock-room-rethink.md, "the mock is a function"): draft = Run(settings,
// seed, your picks). Every bot pick to the next human turn resolves at
// once with no delay, the stamps monotone; undo is a replay with fewer
// picks; the report reads the finished draft, the odds and 200 more runs.
package mock

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// slotStreamKey is the seeded stream a random slot is drawn from.
const slotStreamKey = "slot"

// Settings is one mock's setup: the saved league settings and the board
// the room drafts from, best first, kickers and defenses included.
type Settings struct {
	League apitypes.LeagueSettings
	Pool   []draft.PoolEntry
	// StartedAt stamps START_DRAFT; every later stamp is at or after it.
	StartedAt string
}

// SlotConfig is the roster shape the settings describe, in the order the
// engine fills: starters, the flex spots, K, DEF, the bench.
func SlotConfig(s apitypes.LeagueSettings) ([]draft.SlotConfig, error) {
	r := s.Roster
	flex := draft.SlotConfig{Slot: draft.SlotFlex, EligiblePositions: []draft.Position{draft.RB, draft.WR, draft.TE}}
	var flexRows []draft.SlotConfig
	switch s.Lineup {
	case apitypes.LineupStandard:
		flex.Count = 1
		flexRows = []draft.SlotConfig{flex}
	case apitypes.LineupTwoFlex:
		flex.Count = 2
		flexRows = []draft.SlotConfig{flex}
	case apitypes.LineupSuperflex:
		flex.Count = 1
		flexRows = []draft.SlotConfig{flex, {Slot: draft.SlotSuperflex, Count: 1, EligiblePositions: []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE}}}
	default:
		return nil, fmt.Errorf("mock: unknown lineup %q", s.Lineup)
	}
	rows := []draft.SlotConfig{
		{Slot: draft.SlotQB, Count: r.Qb, EligiblePositions: []draft.Position{draft.QB}},
		{Slot: draft.SlotRB, Count: r.Rb, EligiblePositions: []draft.Position{draft.RB}},
		{Slot: draft.SlotWR, Count: r.Wr, EligiblePositions: []draft.Position{draft.WR}},
		{Slot: draft.SlotTE, Count: r.Te, EligiblePositions: []draft.Position{draft.TE}},
	}
	rows = append(rows, flexRows...)
	rows = append(rows,
		draft.SlotConfig{Slot: draft.SlotK, Count: r.K, EligiblePositions: []draft.Position{draft.K}},
		draft.SlotConfig{Slot: draft.SlotDEF, Count: r.Dst, EligiblePositions: []draft.Position{draft.DEF}},
		draft.SlotConfig{Slot: draft.SlotBench, Count: r.Bench, EligiblePositions: []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE, draft.K, draft.DEF}},
	)
	// A slot the league does not start is absent, not a zero row: a zero
	// row would read as a dedicated slot to the late-round deferral.
	out := rows[:0:0]
	for _, row := range rows {
		if row.Count > 0 {
			out = append(out, row)
		}
	}
	return out, nil
}

// SeatID is seat n's team id, 1-based: seat01, seat02 and on.
func SeatID(n int) string { return fmt.Sprintf("seat%02d", n) }

// HumanSlot is the drafter's slot: the setting, or a draw from the seed.
func HumanSlot(s apitypes.LeagueSettings, seed uint32) int {
	if s.Slot != nil {
		return *s.Slot
	}
	return 1 + int(bots.RngFor(seed, slotStreamKey).Next()*float64(s.Teams))
}
