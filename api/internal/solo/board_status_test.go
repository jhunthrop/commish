package solo

import (
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

func boardRow(id string, position apitypes.PlayerPosition, rank int) apitypes.BoardPlayer {
	return apitypes.BoardPlayer{Id: id, Name: id, Position: position, PositionRank: rank}
}

func ids(players []apitypes.BoardPlayer) []string {
	out := make([]string, len(players))
	for i, p := range players {
		out[i] = p.Id
	}
	return out
}

// A player on a season-long list follows the last available player at
// his position and takes the places after theirs; a week's designation
// keeps his place and carries its mark; a position with nobody available
// keeps its order.
func TestBoardStatuses(t *testing.T) {
	read := time.Date(2026, 10, 16, 14, 5, 0, 0, time.UTC)
	since := time.Date(2026, 10, 14, 15, 0, 0, 0, time.UTC)
	view := apitypes.RoomBoard{Players: []apitypes.BoardPlayer{
		boardRow("a-wr", apitypes.PlayerPositionWR, 1), boardRow("b-rb", apitypes.PlayerPositionRB, 1), boardRow("c-wr", apitypes.PlayerPositionWR, 2),
		boardRow("d-wr", apitypes.PlayerPositionWR, 3), boardRow("e-rb", apitypes.PlayerPositionRB, 2), boardRow("f-te", apitypes.PlayerPositionTE, 1),
		boardRow("g-qb", apitypes.PlayerPositionQB, 1),
	}}
	source := "tank01_injuries_by_date"
	got := withStatuses(view, map[string]boards.Designation{
		"a-wr": {Code: "IR", AsOf: read, Source: source, Since: &since},
		"d-wr": {Code: "D", AsOf: read, Source: source},
		"e-rb": {Code: "PUP", AsOf: read, Source: source},
		"f-te": {Code: "IR", AsOf: read, Source: source},
		"g-qb": {Code: "X", AsOf: read, Source: source},
		"zz":   {Code: "IR", AsOf: read, Source: source},
	})
	if want := []string{"b-rb", "e-rb", "c-wr", "d-wr", "a-wr", "f-te", "g-qb"}; !slices.Equal(ids(got.Players), want) {
		t.Fatalf("order %v, want %v", ids(got.Players), want)
	}
	ranks := map[string]int{}
	byID := map[string]apitypes.BoardPlayer{}
	for _, p := range got.Players {
		ranks[p.Id], byID[p.Id] = p.PositionRank, p
	}
	if want := map[string]int{"c-wr": 1, "d-wr": 2, "a-wr": 3, "b-rb": 1, "e-rb": 2, "f-te": 1, "g-qb": 1}; !maps.Equal(ranks, want) {
		t.Fatalf("position ranks %v, want %v", ranks, want)
	}
	a := byID["a-wr"].Status
	if a == nil || a.Status != apitypes.DesignationStatusInjuredReserve || !a.SeasonLong || a.Since == nil || !a.Since.Equal(since) ||
		!a.AsOf.Equal(read) || a.Source != source {
		t.Fatalf("a-wr's status %+v", a)
	}
	if d := byID["d-wr"].Status; d == nil || d.Status != apitypes.DesignationStatusDoubtful || d.SeasonLong || d.Since != nil {
		t.Fatalf("d-wr's status %+v: a week's mark, no date", d)
	}
	if byID["g-qb"].Status != nil || byID["b-rb"].Status != nil {
		t.Fatal("a code we do not know, or no listing, shows no status")
	}
	if got.StatusRead == nil || !got.StatusRead.AsOf.Equal(read) || got.StatusRead.Source != source {
		t.Fatalf("status read %+v", got.StatusRead)
	}
	if view.Players[0].Id != "a-wr" || view.Players[0].Status != nil {
		t.Fatal("the view handed in was changed")
	}
}

func TestNoCaptureLeavesTheBoard(t *testing.T) {
	view := apitypes.RoomBoard{Players: []apitypes.BoardPlayer{boardRow("a", apitypes.PlayerPositionWR, 1), boardRow("b", apitypes.PlayerPositionWR, 2)}}
	got := withStatuses(view, map[string]boards.Designation{})
	if got.StatusRead != nil || !slices.Equal(ids(got.Players), []string{"a", "b"}) {
		t.Fatalf("board %+v", got)
	}
}
