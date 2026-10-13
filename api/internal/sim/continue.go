// Package sim is the room continuation and what is built on it, ported
// from src/draft-service/sim and grades: Continue drives a real room
// forward with every seat as a bot, RoomOdds plays it many times from one
// state, the seat model reads each opponent's brain from his picks, and
// Grade scores the finished rosters. Every pick passes through the real
// engine, so a simulated roster can never hold what a room would refuse.
package sim

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// SimInstant is the stamp a headless run carries; inert to every reader.
const SimInstant = "2026-01-01T00:00:00.000Z"

// DriverKind is how a seat picks in a continuation.
type DriverKind string

// The two kinds of driver.
const (
	DriveArchetype DriverKind = "archetype"
	DriveAutopick  DriverKind = "autopick"
)

// Basis is whether a seat's brain was read from its picks or assumed.
type Basis string

// The two bases.
const (
	Inferred Basis = "inferred"
	Prior    Basis = "prior"
)

// Driver is one seat's opponent model.
type Driver struct {
	Kind          DriverKind     `json:"kind"`
	Archetype     bots.Archetype `json:"archetype"`
	Basis         Basis          `json:"basis,omitempty"`
	PicksObserved int            `json:"picksObserved"`
}

// Drivers is team id to driver; a seat absent draws the seeded deal.
type Drivers map[string]Driver

func neutralDriver() Driver {
	return Driver{Kind: DriveArchetype, Archetype: bots.Neutral(), Basis: Prior}
}

// ContinueInput is one seeded run of a live room forward.
type ContinueInput struct {
	// State is the room's replayed state, a snake draft in progress.
	State draft.State
	Seed  uint32
	// ThroughPick is the last pick this run plays.
	ThroughPick int
	// ExcludeFromOnClockSeat is held back from the on-clock seat's current
	// pick only, so the players its drafter is deciding between stay on
	// the board for every other seat.
	ExcludeFromOnClockSeat map[string]bool
	Drivers                Drivers
	Strategy               bots.Strategy
	// Keepers are forced at their seat and round and held off the board
	// for every other pick.
	Keepers Keepers
}

// PlayedPick is one pick a run made.
type PlayedPick struct {
	PickNumber int    `json:"pickNumber"`
	TeamID     string `json:"teamId"`
	PlayerID   string `json:"playerId"`
}

// ContinueResult is every pick a run made, the state it ended in, and
// whether the draft completed before ThroughPick.
type ContinueResult struct {
	Played     []PlayedPick
	Final      draft.State
	DraftEnded bool
}

// pickFor is one seat's pick at the current pick number: the clock's
// policy for an autopick seat, else a seeded draw from its archetype on
// the stream "<team>:cont:<pick>".
func pickFor(s draft.State, teamID string, d Driver, seed uint32, excluded map[string]bool, strategy bots.Strategy) (string, bool) {
	board := s
	if len(excluded) > 0 {
		board = s.WithPool(s.Pool.Filter(func(e draft.PoolEntry) bool { return !excluded[e.PlayerID] }))
	}
	if d.Kind == DriveAutopick {
		best, ok := draft.BestAvailableFor(board, teamID)
		return best.PlayerID, ok
	}
	rng := bots.RngFor(seed, fmt.Sprintf("%s:cont:%d", teamID, s.PickNumber))
	return bots.ChooseBotPick(board, teamID, d.Archetype, strategy, rng)
}

// playPick submits the pick through the real engine, stamped at the turn's
// own start so every simulated pick admits.
func playPick(s draft.State, teamID string, d Driver, seed uint32, excluded map[string]bool, strategy bots.Strategy) (draft.State, PlayedPick, bool, error) {
	playerID, ok := pickFor(s, teamID, d, seed, excluded, strategy)
	if !ok {
		return draft.State{}, PlayedPick{}, false, nil
	}
	return submitPick(s, teamID, playerID)
}

// submitPick is one MAKE_PICK through Admit and Reduce.
func submitPick(s draft.State, teamID, playerID string) (draft.State, PlayedPick, bool, error) {
	stamp := SimInstant
	if s.TurnStartedAt != nil {
		stamp = *s.TurnStartedAt
	}
	next, err := draft.Submit(s, draft.NewMakePick(stamp, teamID, playerID))
	if err != nil {
		return draft.State{}, PlayedPick{}, false, fmt.Errorf("sim: MAKE_PICK refused: %w", err)
	}
	return next, PlayedPick{PickNumber: s.PickNumber, TeamID: teamID, PlayerID: playerID}, true, nil
}

func driverFor(drivers Drivers, dealt map[string]bots.Archetype, teamID string) Driver {
	if d, ok := drivers[teamID]; ok {
		return d
	}
	if a, ok := dealt[teamID]; ok {
		return Driver{Kind: DriveArchetype, Archetype: a, Basis: Prior}
	}
	return neutralDriver()
}

// Continue drives the state forward one real MAKE_PICK at a time through
// ThroughPick or the end of the draft. The on-clock seat's current pick
// plays the neutral brain from the board less the exclusion (or the whole
// board, if the exclusion leaves it nothing); every other pick plays its
// seat's driver. The input state is never written.
func Continue(in ContinueInput) (ContinueResult, error) {
	dealt := bots.AssignArchetypes(in.Seed, in.State.DraftOrder)
	onClockPick := in.State.PickNumber
	s := in.State
	played := make([]PlayedPick, 0, max(0, in.ThroughPick-onClockPick+1))
	for !draft.IsComplete(s) && s.PickNumber <= in.ThroughPick {
		team, ok := draft.TeamOnClock(s)
		if !ok {
			break
		}
		var (
			next   draft.State
			pick   PlayedPick
			picked bool
			err    error
		)
		held := in.Keepers.HeldBack(s)
		if kept, forced := in.Keepers.Forced(s, team); forced {
			next, pick, picked, err = submitPick(s, team, kept)
		} else if s.PickNumber == onClockPick {
			next, pick, picked, err = playPick(s, team, neutralDriver(), in.Seed, union(in.ExcludeFromOnClockSeat, held), in.Strategy)
			if err == nil && !picked {
				next, pick, picked, err = playPick(s, team, neutralDriver(), in.Seed, held, in.Strategy)
			}
		} else {
			next, pick, picked, err = playPick(s, team, driverFor(in.Drivers, dealt, team), in.Seed, held, in.Strategy)
		}
		if err != nil {
			return ContinueResult{}, err
		}
		if !picked {
			break
		}
		s = next
		played = append(played, pick)
	}
	return ContinueResult{Played: played, Final: s, DraftEnded: draft.IsComplete(s)}, nil
}
