package solo

import (
	"context"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// DesignationSource is the newest injury capture, by the board's player
// id, each season-long designation dated, from the hourly cache the
// in-season screens read. *inseason.Cache implements it.
type DesignationSource interface {
	DatedDesignations(ctx context.Context) (map[string]boards.Designation, error)
}

// withStatuses is the board with each listed player's designation, and
// the rows ordered by the lane 63 rule: a player on a season-long list
// (boards.SeasonLong) follows the last available player at his position,
// his figures and rank as they are. A week's designation moves nothing.
// A position with nobody available keeps its order. The view handed in is
// not changed.
func withStatuses(view apitypes.RoomBoard, designations map[string]boards.Designation) apitypes.RoomBoard {
	out := view
	out.Players = make([]apitypes.BoardPlayer, len(view.Players))
	copy(out.Players, view.Players)
	read := boards.StatusRead(designations)
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

// belowTheAvailable moves each held player (on a season-long list) to
// just after the last available player at his position, in their order.
// Ranks stay the store's: a held player's rank is his figure's, which
// assumes he plays, and his status says why he follows.
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
	return ordered
}
