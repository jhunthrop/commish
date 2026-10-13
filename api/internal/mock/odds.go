package mock

import (
	"context"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// The sources a pick's odds can come from.
const (
	// OddsAdvisor is the advisor service's survival, the room's own card.
	OddsAdvisor = "advisor"
	// OddsSim is the engine's room odds (sim.SimulateRoomOdds).
	OddsSim = "sim"
)

// PickOdds is the odds the room showed the drafter when he picked: for
// every player on the board, the chance he lasts to the drafter's next
// turn. The room writes it with the pick, in the MAKE_PICK row's
// app.mock_actions payload under "odds" (Lane 6), from whichever service
// produced the card; the report's hindsight reads it back, so the page
// says what the room said at the time.
type PickOdds struct {
	// Source is OddsAdvisor or OddsSim.
	Source string `json:"source"`
	// NextPick is the drafter's next turn, the pick the odds look to.
	NextPick int `json:"nextPick"`
	// Runs is how many runs the shares are over; 0 for a closed form.
	Runs int `json:"runs"`
	// StillThere is player id to the chance he is still there at NextPick.
	StillThere map[string]float64 `json:"stillThere"`
}

// OddsRequest is the room as it stood before one of the drafter's picks.
type OddsRequest struct {
	State  draft.State
	TeamID string
	// PassedOn is the player picked, held back from the drafter's own
	// turn: the question is whether he would have lasted.
	PassedOn string
	// Keepers are forced at their seats and never read as still there.
	Keepers sim.Keepers
}

// Odds answers hindsight for a pick that carries no recorded odds: the
// fallback when a log predates the room recording them.
type Odds interface {
	Survival(ctx context.Context, req OddsRequest) (PickOdds, error)
}

// SimOdds answers Odds with the engine's own room odds: the seats read by
// the seat model, the pick being judged held back from the drafter's turn.
type SimOdds struct {
	Seed    uint32
	Runs    int
	Workers int
}

// Survival is the share of runs each player lasted to the next turn.
func (o SimOdds) Survival(ctx context.Context, req OddsRequest) (PickOdds, error) {
	strategy := bots.DefaultStrategy()
	table, err := sim.SimulateRoomOdds(ctx, sim.RoomOddsInput{
		State: req.State, Seed: o.Seed, Runs: o.Runs, Drivers: sim.InferSeatDrivers(req.State, strategy, sim.DefaultSeatModel()),
		ExcludeFromOnClockSeat: map[string]bool{req.PassedOn: true}, Strategy: strategy, Keepers: req.Keepers, Workers: o.Workers,
	})
	if err != nil {
		return PickOdds{}, err
	}
	out := PickOdds{Source: OddsSim, Runs: table.Runs, StillThere: map[string]float64{}}
	survival, ok := sim.SurvivalFor(table, req.State, req.TeamID)
	if !ok {
		return out, nil
	}
	out.NextPick = survival.PickNumber
	if survival.RunsReached == 0 {
		return out, nil
	}
	for id, n := range survival.Survived {
		out.StillThere[id] = float64(n) / float64(survival.RunsReached)
	}
	return out, nil
}
