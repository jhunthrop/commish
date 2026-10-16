package solo

import (
	"context"
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// DesignationSource is the newest injury capture, by the board's player
// id, from the hourly cache the in-season screens read.
// *inseason.Cache implements it.
type DesignationSource interface {
	Designations(ctx context.Context) (map[string]boards.Designation, error)
}

// withStatuses is the board with each listed player's designation, and
// the rows ordered by the lane 63 rule: a player on a season-long list
// (boards.SeasonLong) follows the last available player at his position
// and takes the places after theirs, his figures as they are. A week's
// designation moves nothing. A position with nobody available keeps its
// order. The view handed in is not changed.
func withStatuses(view apitypes.RoomBoard, designations map[string]boards.Designation) apitypes.RoomBoard {
	out := view
	out.Players = make([]apitypes.BoardPlayer, len(view.Players))
	copy(out.Players, view.Players)
	read := statusRead(designations)
	if read == nil {
		return out
	}
	out.StatusRead = read
	held := map[string]bool{}
	for i, p := range out.Players {
		d, ok := designations[p.Id]
		status := d.Status()
		if !ok || status == "" {
			continue
		}
		out.Players[i].Status = &apitypes.BoardStatus{
			Status: apitypes.DesignationStatus(status), SeasonLong: d.SeasonLong(), Since: d.Since, AsOf: d.AsOf, Source: d.Source,
		}
		held[p.Id] = d.SeasonLong()
	}
	out.Players = belowTheAvailable(out.Players, held)
	return out
}

// statusRead is the capture the designations come from, nil with none.
func statusRead(designations map[string]boards.Designation) *apitypes.StatusRead {
	var read *apitypes.StatusRead
	for _, d := range designations {
		if read == nil || d.AsOf.After(read.AsOf) {
			read = &apitypes.StatusRead{AsOf: d.AsOf, Source: d.Source}
		}
	}
	return read
}

// belowTheAvailable moves each held player (on a season-long list) to
// just after the last available player at his position, in their order,
// and renumbers each position's ranks: the available first in their
// order, then the held.
func belowTheAvailable(players []apitypes.BoardPlayer, held map[string]bool) []apitypes.BoardPlayer {
	lastAvailable := map[apitypes.PlayerPosition]int{}
	waiting := map[apitypes.PlayerPosition][]apitypes.BoardPlayer{}
	for i, p := range players {
		if held[p.Id] {
			waiting[p.Position] = append(waiting[p.Position], p)
		} else {
			lastAvailable[p.Position] = i
		}
	}
	ordered := make([]apitypes.BoardPlayer, 0, len(players))
	for i, p := range players {
		last, anyAvailable := lastAvailable[p.Position]
		if !held[p.Id] || !anyAvailable {
			ordered = append(ordered, p)
		}
		if anyAvailable && i == last {
			ordered = append(ordered, waiting[p.Position]...)
		}
	}
	renumber(ordered, held)
	return ordered
}

// renumber gives each position's ranked players 1, 2, ... by their
// place at it, the available before the held.
func renumber(players []apitypes.BoardPlayer, held map[string]bool) {
	byPosition := map[apitypes.PlayerPosition][]int{}
	for i, p := range players {
		if p.PositionRank > 0 {
			byPosition[p.Position] = append(byPosition[p.Position], i)
		}
	}
	for _, at := range byPosition {
		sort.SliceStable(at, func(a, b int) bool {
			pa, pb := players[at[a]], players[at[b]]
			if held[pa.Id] != held[pb.Id] {
				return !held[pa.Id]
			}
			return pa.PositionRank < pb.PositionRank
		})
		for rank, i := range at {
			players[i].PositionRank = rank + 1
		}
	}
}
