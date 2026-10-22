package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// PlayingRanks is each board player's place at his position among the
// players on no season-long list (Lane 128 review fix round 2): the
// board's position order with the listed players taken out and the rest
// numbered 1..n, so the line's position_rank, the badge, the caption and
// the Rest of season position view's # are one number. A listed player
// has none (the order places him after every available one).
func PlayingRanks(b boards.Board, listed func(boards.Player) bool) map[string]int {
	byPosition := map[draft.Position][]boards.Player{}
	for _, p := range b.Raw.Players {
		if b.PositionRanks[p.ID] > 0 && !listed(p) {
			byPosition[p.Position] = append(byPosition[p.Position], p)
		}
	}
	out := make(map[string]int, len(b.Raw.Players))
	for _, players := range byPosition {
		sort.SliceStable(players, func(i, j int) bool {
			return b.PositionRanks[players[i].ID] < b.PositionRanks[players[j].ID]
		})
		for i, p := range players {
			out[p.ID] = i + 1
		}
	}
	return out
}

// playingRanks is the read's PlayingRanks, computed once: a player is on
// a season-long list as his line reads it (seasonLong), the roster's IR
// mark included.
func (a *advisor) playingRanks() map[string]int {
	if a.playing == nil {
		hosts := a.hostIDs()
		a.playing = PlayingRanks(a.Board, func(p boards.Player) bool { return a.seasonLong(p, hosts) })
	}
	return a.playing
}
