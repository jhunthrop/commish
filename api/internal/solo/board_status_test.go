package solo

import (
	"encoding/json"
	"maps"
	"os"
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
// his position, his rank the store's; a week's designation
// keeps his place and carries its mark; a position with nobody available
// keeps its order.
func TestBoardStatuses(t *testing.T) {
	read := time.Date(2026, 10, 16, 14, 5, 0, 0, time.UTC)
	since := time.Date(2026, 10, 14, 15, 0, 0, 0, time.UTC)
	checked := time.Date(2026, 10, 16, 15, 5, 0, 0, time.UTC)
	view := apitypes.RoomBoard{Players: []apitypes.BoardPlayer{
		boardRow("a-wr", apitypes.PlayerPositionWR, 1), boardRow("b-rb", apitypes.PlayerPositionRB, 1), boardRow("c-wr", apitypes.PlayerPositionWR, 2),
		boardRow("d-wr", apitypes.PlayerPositionWR, 3), boardRow("e-rb", apitypes.PlayerPositionRB, 2), boardRow("f-te", apitypes.PlayerPositionTE, 1),
		boardRow("g-qb", apitypes.PlayerPositionQB, 1),
	}}
	source := "tank01_injuries_by_date"
	got := withStatuses(view, map[string]boards.Designation{
		"a-wr": {Code: "IR", AsOf: read, Source: source, Since: &since, CheckedAt: &checked},
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
	if want := map[string]int{"a-wr": 1, "b-rb": 1, "c-wr": 2, "d-wr": 3, "e-rb": 2, "f-te": 1, "g-qb": 1}; !maps.Equal(ranks, want) {
		t.Fatalf("position ranks %v, want the store's %v", ranks, want)
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
	if got.StatusRead == nil || !got.StatusRead.AsOf.Equal(read) || got.StatusRead.Source != source ||
		got.StatusRead.CheckedAt == nil || !got.StatusRead.CheckedAt.Equal(checked) {
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

// orderCases is api/testdata/board-order-cases.json, the cases the site's
// order (web/src/lib/run/board-status.ts) is held to as well.
type orderCases struct {
	Cases []struct {
		Name   string
		Rows   [][2]string
		Listed map[string]struct {
			Code       string
			Status     string
			SeasonLong bool `json:"season_long"`
		}
		Want []string
	}
}

func TestTheSharedOrderCases(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/board-order-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var file orderCases
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	read := time.Date(2026, 10, 16, 14, 5, 0, 0, time.UTC)
	for _, c := range file.Cases {
		view := apitypes.RoomBoard{}
		for i, r := range c.Rows {
			view.Players = append(view.Players, boardRow(r[0], apitypes.PlayerPosition(r[1]), i+1))
		}
		designations := map[string]boards.Designation{}
		for id, l := range c.Listed {
			d := boards.Designation{Code: l.Code, AsOf: read, Source: "tank01_injuries_by_date"}
			if d.Status() != l.Status || d.SeasonLong() != l.SeasonLong {
				t.Fatalf("%s: %s reads as %s (season-long %v), the case says %s", c.Name, l.Code, d.Status(), d.SeasonLong(), l.Status)
			}
			designations[id] = d
		}
		if got := ids(withStatuses(view, designations).Players); !slices.Equal(got, c.Want) {
			t.Errorf("%s: %v, want %v", c.Name, got, c.Want)
		}
	}
}
