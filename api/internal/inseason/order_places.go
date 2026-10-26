package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The order's places, one rule for the order's rows and the player read's
// per-format ranks (Lane 227, B206 and B209): a board's players in our
// order, the players on a season-long list after the rest, and each
// player's place in that full order whatever the answer then moves.

// startsAny is whether one of the league's starting spots takes p.
func startsAny(slots []Slot, p draft.Position) bool {
	for _, s := range slots {
		if s.accepts(p) {
			return true
		}
	}
	return false
}

// orderOf is a board's players in our order: at a position by his
// position rank, across positions by points over replacement (a player
// with no value after every valued one). Only the positions the order
// ranks and the league starts.
func orderOf(b boards.Board, position draft.Position, starts func(draft.Position) bool) []boards.Player {
	var players []boards.Player
	for _, p := range b.Raw.Players {
		if inOrder(p, position, starts) {
			players = append(players, p)
		}
	}
	sort.SliceStable(players, func(i, j int) bool { return placedAhead(b, position, players[i], players[j]) })
	return players
}

// inOrder is whether the view's order (a position, or "" for every one)
// ranks p.
func inOrder(p boards.Player, position draft.Position, starts func(draft.Position) bool) bool {
	return (position == "" || p.Position == position) && orderPositions[p.Position] && starts(p.Position)
}

// placedAhead is whether q's key puts him strictly before p in the view's order:
// at a position the lower position rank, across positions the higher
// points over replacement, a valued player before an unvalued one. Equal
// keys keep the board's order (orderOf sorts stably).
func placedAhead(b boards.Board, position draft.Position, q, p boards.Player) bool {
	if position != "" {
		return b.PositionRanks[q.ID] < b.PositionRanks[p.ID]
	}
	vq, hq := b.Values[q.ID]
	vp, hp := b.Values[p.ID]
	if hq != hp {
		return hq
	}
	return hq && vq > vp
}

// orderPlaces is an order as an answer draws it: its players, each one's
// place in the answer (rank) and his place in the full order before any
// byes-last move (overall).
type orderPlaces struct {
	players []boards.Player
	rank    []int
	overall []int
}

// placesOf numbers an order (Lane 128, Lane 163 D06, Lane 227 B209). The
// full order is every player on a season-long list after every available
// one, each group kept in its order and numbered on: each player's overall
// place. With onBye set, an available player it holds comes last of all
// and the answer is numbered 1..n as drawn, so from the first bye down
// rank and overall differ; nil keeps the full order, rank equal to
// overall.
func placesOf(players []boards.Player, listed, onBye func(boards.Player) bool) orderPlaces {
	var playing, out, byes []boards.Player
	// The full order keeps a bye in his place among the available.
	overallOf := make(map[string]int, len(players))
	for _, p := range players {
		switch {
		case listed(p):
			out = append(out, p)
			continue
		case onBye != nil && onBye(p):
			byes = append(byes, p)
		default:
			playing = append(playing, p)
		}
		overallOf[p.ID] = len(playing) + len(byes)
	}
	n := len(playing) + len(byes)
	for _, p := range out {
		n++
		overallOf[p.ID] = n
	}
	drawn := make([]boards.Player, 0, len(players))
	drawn = append(append(append(drawn, playing...), out...), byes...)
	places := orderPlaces{players: drawn, rank: make([]int, len(drawn)), overall: make([]int, len(drawn))}
	for i, p := range drawn {
		places.rank[i], places.overall[i] = i+1, overallOf[p.ID]
	}
	return places
}

// playingPlace is p's place in the full numbering of the view's order on
// b (orderOf, placesOf) without sorting it: one more than the players who
// play and come before him. nil when the order does not rank him or he is
// on a season-long list (his row draws the list's word, never a number).
func playingPlace(b boards.Board, position draft.Position, starts func(draft.Position) bool, p boards.Player, listed func(boards.Player) bool) *int {
	if !inOrder(p, position, starts) || listed(p) {
		return nil
	}
	n, found := 1, false
	for _, q := range b.Raw.Players {
		if q.ID == p.ID {
			found = true
			continue
		}
		// Equal keys keep the board's order: a player met before him is ahead.
		before := placedAhead(b, position, q, p) || (!found && !placedAhead(b, position, p, q))
		if before && inOrder(q, position, starts) && !listed(q) {
			n++
		}
	}
	if !found {
		return nil
	}
	return &n
}
