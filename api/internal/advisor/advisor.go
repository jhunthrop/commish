// Package advisor is the room's card: our call at a pick, the runner-up's
// numbers, and every player's chance of lasting to the drafter's next
// turn. At launch the advice is the research lane's service (POST
// /advise, research-ts/README.md) over HTTP; when that is unset or does
// not answer in time, the engine's own room odds answer instead, and the
// card says which (spec §2.3, the room doc's "our call").
package advisor

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// The sources a card's odds come from, the same words mock.PickOdds records.
const (
	SourceAdvisor = "advisor"
	SourceSim     = "sim"
)

// Request is the room as it stands with a seat on the clock.
type Request struct {
	State draft.State
	// TeamID is the seat the card is for, on the clock.
	TeamID string
	Board  boards.Board
	Teams  int
	// Keepers are forced at their seats and never offered.
	Keepers sim.Keepers
	// Seed seeds the engine's runs, so the fallback card is the same twice.
	Seed uint32
}

// Candidate is one of the shortlist, best first.
type Candidate struct {
	PlayerID string `json:"player_id"`
	// Why is the advisor's sentence for him; empty from the engine.
	Why string `json:"why,omitempty"`
}

// Card is what the room shows at a pick.
type Card struct {
	PickNumber int `json:"pick_number"`
	// NextPick is the seat's next turn, nil at its last pick.
	NextPick *int   `json:"next_pick"`
	Source   string `json:"source"`
	// Runs is how many runs the odds are over, 0 for the closed form.
	Runs int `json:"runs"`
	// Call is the player we would take, the shortlist's first.
	Call      string      `json:"call"`
	Shortlist []Candidate `json:"shortlist"`
	// StillThere is player id to his chance of lasting to NextPick.
	StillThere map[string]float64 `json:"still_there"`
}

// Advisor makes the card.
type Advisor interface {
	Card(ctx context.Context, req Request) (Card, error)
}

// Fallback asks Primary within Timeout and answers from Secondary when it
// is unset, slow or wrong. A nil Primary is the development default.
type Fallback struct {
	Primary   Advisor
	Secondary Advisor
	Timeout   time.Duration
	Log       *slog.Logger
}

// Card is the primary's card, or the secondary's.
func (f Fallback) Card(ctx context.Context, req Request) (Card, error) {
	if f.Primary != nil {
		pctx, cancel := context.WithTimeout(ctx, f.Timeout)
		card, err := f.Primary.Card(pctx, req)
		cancel()
		if err == nil {
			return card, nil
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return Card{}, ctx.Err()
		}
		f.Log.Warn("advisor: falling back to the engine", "pick", req.State.PickNumber, "err", err)
	}
	return f.Secondary.Card(ctx, req)
}
