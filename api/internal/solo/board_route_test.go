package solo

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

type fixedBoards struct{ raw *boards.Raw }

func (f fixedBoards) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	slots, err := mock.SlotConfig(s)
	if err != nil {
		return boards.Board{}, err
	}
	return boards.For(f.raw, s.Teams, slots)
}

type fixedDesignations struct {
	d   map[string]boards.Designation
	err error
}

func (f fixedDesignations) DatedDesignations(context.Context) (map[string]boards.Designation, error) {
	return f.d, f.err
}

func routeBoard(t *testing.T, designations DesignationSource) apitypes.RoomBoard {
	t.Helper()
	points := func(v float64) *float64 { return &v }
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Players: []boards.Player{
		{ID: "wr-1", Name: "Hurt Receiver", Position: draft.WR, Team: "BUF", Points: points(250)},
		{ID: "wr-2", Name: "Second Receiver", Position: draft.WR, Team: "MIA", Points: points(200)},
		{ID: "rb-1", Name: "Lead Back", Position: draft.RB, Team: "NE", Points: points(220)},
	}}
	s := &Service{Boards: fixedBoards{raw}, Designations: designations, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	r := httptest.NewRequest(http.MethodGet, "/boards/ppr", nil)
	r.SetPathValue("format", "ppr")
	w := httptest.NewRecorder()
	s.handleBoard(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var env struct {
		Data apitypes.RoomBoard `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	return env.Data
}

func TestTheBoardRouteCarriesTheCapture(t *testing.T) {
	read := time.Date(2026, 10, 16, 14, 5, 0, 0, time.UTC)
	got := routeBoard(t, fixedDesignations{d: map[string]boards.Designation{
		"wr-1": {Code: "IR", AsOf: read, Source: "tank01_injuries_by_date"},
	}})
	if ids(got.Players)[0] != "wr-2" || got.Players[1].Id != "wr-1" || got.Players[1].PositionRank != 1 || got.Players[0].PositionRank != 2 {
		t.Fatalf("players %+v: the receiver on injured reserve follows the available one", got.Players)
	}
	if got.Players[1].Status == nil || !got.Players[1].Status.SeasonLong || got.Players[1].Points == nil || *got.Players[1].Points != 250 {
		t.Fatalf("his row %+v: the status, his figures as they are", got.Players[1])
	}
	if got.StatusRead == nil || !got.StatusRead.AsOf.Equal(read) {
		t.Fatalf("status read %+v", got.StatusRead)
	}
}

func TestTheBoardRouteWithoutTheCapture(t *testing.T) {
	for name, source := range map[string]DesignationSource{
		"no source": nil, "a failed read": fixedDesignations{err: errors.New("down")},
	} {
		got := routeBoard(t, source)
		if got.StatusRead != nil || got.Players[0].Id != "wr-1" || got.Players[0].Status != nil {
			t.Errorf("%s: %+v, want the store's board with no status claimed", name, got)
		}
	}
}

// The board route sends each figure as the tenth the room prints (Lane
// 66k H1): an ADP of 9.45 leaves as 9.5, a projection of 244.05 as 244.1.
func TestTheBoardRouteSendsTenths(t *testing.T) {
	adp, points, second := 9.45, 244.05, 101.25
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Players: []boards.Player{
		{ID: "wr-1", Name: "A Receiver", Position: draft.WR, Team: "BUF", ADP: &adp, Points: &points},
		{ID: "wr-2", Name: "B Receiver", Position: draft.WR, Team: "MIA", Points: &second},
	}}
	s := &Service{Boards: fixedBoards{raw}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	r := httptest.NewRequest(http.MethodGet, "/boards/ppr", nil)
	r.SetPathValue("format", "ppr")
	w := httptest.NewRecorder()
	s.handleBoard(w, r)
	var env struct {
		Data apitypes.RoomBoard `json:"data"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &env) != nil {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	first := env.Data.Players[0]
	if first.Adp == nil || *first.Adp != 9.5 || first.Points == nil || *first.Points != 244.1 {
		t.Fatalf("figures %v %v, want 9.5 and 244.1", first.Adp, first.Points)
	}
	for _, p := range env.Data.Players {
		if p.Vor != nil && *p.Vor != tenth.Round(*p.Vor) {
			t.Fatalf("%s over replacement %v is not a tenth", p.Id, *p.Vor)
		}
	}
}
