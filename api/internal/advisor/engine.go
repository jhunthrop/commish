package advisor

import (
	"context"
	"fmt"
	"slices"
	"sort"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// callDepth is how far down the value order the call looks: the room
// doc's call weighs the best eight legal players by what they are worth
// and how likely each is to be there.
const callDepth = 8

// Engine answers the card from the engine's own room odds: 200 seeded
// runs of this room with each seat read by the seat model, the share of
// runs each player lasted to the seat's next turn.
type Engine struct {
	Runs    int
	Workers int
}

// odds is the engine's survival for the seat: each player's share of runs
// still there at the seat's next turn, which is the turn after this one
// on the clock and the coming one off it.
func (e Engine) odds(ctx context.Context, req Request) (Card, error) {
	strategy := bots.DefaultStrategy()
	table, err := sim.SimulateRoomOdds(ctx, sim.RoomOddsInput{
		State: req.State, Seed: req.Seed, Runs: e.Runs, Strategy: strategy, Keepers: req.Keepers, Workers: e.Workers,
		Drivers: sim.InferSeatDrivers(req.State, strategy, sim.DefaultSeatModel()),
	})
	if err != nil {
		return Card{}, fmt.Errorf("advisor: room odds: %w", err)
	}
	card := Card{PickNumber: req.State.PickNumber, Source: SourceSim, Runs: table.Runs, StillThere: map[string]float64{}}
	if survival, ok := sim.SurvivalFor(table, req.State, req.TeamID); ok {
		next := survival.PickNumber
		card.NextPick = &next
		if survival.RunsReached > 0 {
			for id, n := range survival.Survived {
				card.StillThere[id] = float64(n) / float64(survival.RunsReached)
			}
		}
	}
	return card, nil
}

func (card *Card) setShortlist(ids []string, req Request) error {
	if len(ids) == 0 {
		return fmt.Errorf("advisor: nobody left can fill %s's roster at pick %d", req.TeamID, req.State.PickNumber)
	}
	card.Call = ids[0]
	for _, id := range ids {
		card.Shortlist = append(card.Shortlist, Candidate{PlayerID: id})
	}
	return nil
}

// Card is the engine's card for the seat on the clock: of the best eight,
// the one whose value is likeliest lost by waiting (value times the
// chance he is gone by the next turn).
func (e Engine) Card(ctx context.Context, req Request) (Card, error) {
	card, err := e.odds(ctx, req)
	if err != nil {
		return Card{}, err
	}
	ids := Shortlist(req.State, req.TeamID, req.Board, req.Keepers.HeldBack(req.State), func(id string, value float64) float64 {
		if card.NextPick == nil {
			return value
		}
		return value * (1 - card.StillThere[id])
	})
	return card, card.setShortlist(ids, req)
}

// Conditional is the card for a seat off the clock in a lobby: each
// player's chance of reaching the seat's coming turn, and the call if the
// board holds to it, the best eight weighed by value times the chance he
// is there to take.
func (e Engine) Conditional(ctx context.Context, req Request) (Card, error) {
	card, err := e.odds(ctx, req)
	if err != nil {
		return Card{}, err
	}
	if card.NextPick == nil {
		return Card{}, &draft.Refusal{Reason: "You have no pick left in this draft."}
	}
	ids := Shortlist(req.State, req.TeamID, req.Board, req.Keepers.HeldBack(req.State), func(id string, value float64) float64 {
		return value * card.StillThere[id]
	})
	return card, card.setShortlist(ids, req)
}

// LegalFor is whether the seat can roster a player of a position now: a
// slot takes him, and once the roster is down to its open starters, he
// is one of the positions they still need.
func LegalFor(s draft.State, teamID string) func(draft.Position) bool {
	roster := draft.RosterFor(s, teamID)
	restricted := draft.RestrictedPositions(s.Config.SlotConfig, roster)
	return func(p draft.Position) bool {
		if restricted != nil && !slices.Contains(restricted, p) {
			return false
		}
		return draft.AssignSlot(p, roster, s.Config.SlotConfig).OK
	}
}

// Shortlist is the call rule, best first: the eight legal players worth
// the most over replacement, ordered by score(id, value). With no valued
// player legal (only a kicker or defense slot open) it is the legal
// players in the order drafters take them.
func Shortlist(s draft.State, teamID string, b boards.Board, held map[string]bool, score func(id string, value float64) float64) []string {
	legal := LegalFor(s, teamID)
	type scored struct {
		id    string
		value float64
		score float64
	}
	var valued []scored
	var market []string
	for _, e := range draft.AvailablePool(s) {
		if held[e.PlayerID] || !legal(e.Position) {
			continue
		}
		if v, ok := b.Values[e.PlayerID]; ok {
			valued = append(valued, scored{id: e.PlayerID, value: v})
		} else if len(market) < shortlistSize {
			market = append(market, e.PlayerID)
		}
	}
	if len(valued) == 0 {
		return market
	}
	sort.SliceStable(valued, func(i, j int) bool { return valued[i].value > valued[j].value })
	top := valued[:min(callDepth, len(valued))]
	for i := range top {
		top[i].score = score(top[i].id, top[i].value)
	}
	sort.SliceStable(top, func(i, j int) bool { return top[i].score > top[j].score })
	out := make([]string, 0, shortlistSize)
	for _, c := range top[:min(shortlistSize, len(top))] {
		out = append(out, c.id)
	}
	return out
}
