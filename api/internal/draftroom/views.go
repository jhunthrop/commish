package draftroom

import (
	"slices"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// SeatNumber is a seat's 1-based draft slot: its place in the order.
func SeatNumber(order []string, teamID string) int {
	return slices.Index(order, teamID) + 1
}

// Picks is every pick on the wire, in the order made.
func Picks(s draft.State) []apitypes.RoomPick {
	out := make([]apitypes.RoomPick, len(s.Picks))
	for i, p := range s.Picks {
		out[i] = apitypes.RoomPick{Pick: p.PickNumber, Round: p.Round, Seat: SeatNumber(s.DraftOrder, p.TeamID), PlayerId: p.PlayerID, Auto: p.Auto}
	}
	return out
}

// OnClock is the slot on the clock, nil when the draft is over.
func OnClock(s draft.State) *int {
	team, ok := draft.TeamOnClock(s)
	if !ok {
		return nil
	}
	n := SeatNumber(s.DraftOrder, team)
	return &n
}

// oddsDepth is how deep a card's odds reach into the undrafted pool, in
// the order drafters take players: the depth the advisor is asked about,
// and as far as any call or row the room leads with goes. A player past it
// carries no odds on the card and none is printed for him.
const oddsDepth = 400

// Trim keeps a card's odds to the undrafted players within oddsDepth of
// the top of the pool, plus every player on the shortlist.
func Trim(card advisor.Card, s draft.State) advisor.Card {
	keep := map[string]bool{}
	for _, c := range card.Shortlist {
		keep[c.PlayerID] = true
	}
	depth := 0
	for _, e := range draft.AvailablePool(s) {
		if depth >= oddsDepth {
			break
		}
		keep[e.PlayerID] = true
		depth++
	}
	out := card
	out.StillThere = make(map[string]float64, len(keep))
	for id, p := range card.StillThere {
		if keep[id] {
			out.StillThere[id] = round4(p)
		}
	}
	return out
}

func round4(v float64) float64 {
	const scale = 10000
	return float64(int64(v*scale+0.5)) / scale
}

// CardView is a card on the wire.
func CardView(card advisor.Card, forPick int, conditional bool) apitypes.RoomCard {
	out := apitypes.RoomCard{
		PickNumber: card.PickNumber, ForPick: forPick, NextPick: card.NextPick, Source: apitypes.RoomCardSource(card.Source),
		Runs: card.Runs, Call: card.Call, StillThere: card.StillThere, Conditional: conditional,
		Shortlist: make([]apitypes.CardCandidate, len(card.Shortlist)),
	}
	for i, c := range card.Shortlist {
		out.Shortlist[i] = apitypes.CardCandidate{PlayerId: c.PlayerID}
		if c.Why != "" {
			why := c.Why
			out.Shortlist[i].Why = &why
		}
	}
	return out
}

// PickOdds is a card as the odds a pick records (mock.PickOdds), read
// back by the report's hindsight.
func PickOdds(card advisor.Card) *mock.PickOdds {
	if card.NextPick == nil {
		return nil
	}
	return &mock.PickOdds{Source: card.Source, NextPick: *card.NextPick, Runs: card.Runs, StillThere: card.StillThere}
}

// StandIn is the pick a seat's stand-in makes when its drafter is not the
// one picking (Pick for me, a closed tab, an expired clock): the first
// legal player in the queue, then in the sheet, then the clock's own
// choice from the board. held is every kept player not yet drafted.
func StandIn(s draft.State, teamID string, sheet []string, held map[string]bool) (string, bool) {
	board := s
	if len(held) > 0 {
		board = s.WithPool(s.Pool.Filter(func(e draft.PoolEntry) bool { return !held[e.PlayerID] }))
	}
	legal := advisor.LegalFor(board, teamID)
	taken := draft.TakenOn(board)
	for _, list := range [][]string{draft.QueueFor(board, teamID), sheet} {
		for _, id := range list {
			e, i, ok := board.Pool.Lookup(id)
			if ok && !taken.At(i) && legal(e.Position) {
				return id, true
			}
		}
	}
	best, ok := draft.BestAvailableFor(board, teamID)
	return best.PlayerID, ok
}
