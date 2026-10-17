package inseason

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// restOfSeasonFixture is the fixture league on the rest-of-season order
// from week 6, as the published run ranks it in season.
func restOfSeasonFixture(t *testing.T) fixture {
	t.Helper()
	f := newFixture(t)
	f.raw.Order, f.raw.FromWeek = boards.OrderRestOfSeason, 6
	config, err := mock.SlotConfig(*f.league.Saved)
	if err != nil {
		t.Fatal(err)
	}
	if f.league.Board, err = boards.For(f.raw, f.league.Saved.Teams, config); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestOrderRanksAPositionByItsRestOfSeasonTotal(t *testing.T) {
	f := restOfSeasonFixture(t)
	out := newFixtureAdvisor(t, f, nil).Order(orderQuery{position: draft.RB, limit: MaxOrderRows}, true)
	if len(out.Rows) == 0 || out.Total != len(out.Rows) {
		t.Fatalf("rows %d of %d", len(out.Rows), out.Total)
	}
	for i, row := range out.Rows {
		if row.Line.Player.Position != string(draft.RB) {
			t.Fatalf("row %d is a %s", i, row.Line.Player.Position)
		}
		if row.Rank != i+1 || row.Line.PositionRank == nil || *row.Line.PositionRank != row.Rank {
			t.Fatalf("row %d: rank %d, position rank %v", i, row.Rank, row.Line.PositionRank)
		}
		// The fixture's schedule ends at week 6, so a club on bye that week
		// has no game left and no points a game: the total still ranks him.
		if row.RestOfSeasonPoints == nil {
			t.Fatalf("row %d carries no rest-of-season total", i)
		}
		if i > 0 && *row.RestOfSeasonPoints > *out.Rows[i-1].RestOfSeasonPoints {
			t.Fatalf("row %d's total %v tops the row above's %v", i, *row.RestOfSeasonPoints, *out.Rows[i-1].RestOfSeasonPoints)
		}
	}
	if out.FromWeek == nil || *out.FromWeek != 6 || !strings.Contains(out.Basis, "from week 6") {
		t.Fatalf("from week %v, basis %q", out.FromWeek, out.Basis)
	}
}

func TestOrderAcrossPositionsRanksByValueThenKickersAndDefenses(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{limit: MaxOrderRows}, false)
	sawMarket := false
	for i, row := range out.Rows {
		if row.Rank != i+1 {
			t.Fatalf("row %d ranks %d", i, row.Rank)
		}
		market := row.Line.Player.Position == string(draft.K) || row.Line.Player.Position == string(draft.DEF)
		if market != (row.RestOfSeasonPoints == nil) {
			t.Fatalf("%s: a %s with total %v", row.Line.Player.Name, row.Line.Player.Position, row.RestOfSeasonPoints)
		}
		if sawMarket && !market {
			t.Fatalf("%s follows a kicker or defense", row.Line.Player.Name)
		}
		sawMarket = sawMarket || market
		if i > 0 && !market {
			prev, cur := *out.Rows[i-1].Line.Player.BoardId, *row.Line.Player.BoardId
			if a.Board.Values[cur] > a.Board.Values[prev] {
				t.Fatalf("%s outvalues the row above", row.Line.Player.Name)
			}
		}
		if row.Roster != nil || row.Move != nil {
			t.Fatalf("%s carries a roster or a move without marks", row.Line.Player.Name)
		}
	}
	if !sawMarket || out.ReadAt != nil {
		t.Fatalf("kickers and defenses %v, read at %v", sawMarket, out.ReadAt)
	}
}

func TestOrderMarksRostersAndTheMoveARowAdmits(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	targets := a.tradeTargets()
	if len(targets) == 0 {
		t.Fatal("the finder brings in nobody, so the test proves nothing")
	}
	out := a.Order(orderQuery{limit: MaxOrderRows}, true)
	kinds := map[apitypes.RosterMarkKind]int{}
	trades := 0
	for _, row := range out.Rows {
		id := *row.Line.Player.BoardId
		holder, held := f.league.HeldBy[id]
		kinds[row.Roster.Kind]++
		switch row.Roster.Kind {
		case apitypes.RosterMarkKindYours:
			if holder != 1 || row.Move != nil {
				t.Fatalf("%s: yours on roster %d with move %v", id, holder, row.Move)
			}
		case apitypes.RosterMarkKindFree:
			if held || row.Move == nil || *row.Move != apitypes.OrderRowMoveAdd {
				t.Fatalf("%s: free but held %v, move %v", id, held, row.Move)
			}
		case apitypes.RosterMarkKindTeam:
			if !held || holder == 1 || row.Roster.Team == nil || *row.Roster.Team == "" {
				t.Fatalf("%s: on team %v of roster %d", id, row.Roster.Team, holder)
			}
			if (row.Move != nil) != targets[id] {
				t.Fatalf("%s: move %v but the finder brings him in: %v", id, row.Move, targets[id])
			}
			if row.Move != nil {
				trades++
			}
		}
	}
	if kinds[apitypes.RosterMarkKindYours] == 0 || kinds[apitypes.RosterMarkKindFree] == 0 || kinds[apitypes.RosterMarkKindTeam] == 0 || trades == 0 {
		t.Fatalf("kinds %v, trades %d", kinds, trades)
	}
	if trades == kinds[apitypes.RosterMarkKindTeam] {
		t.Fatal("every rostered player admits a trade: the finder is not deciding")
	}
	if out.ReadAt == nil {
		t.Fatalf("read at %v, note %v", out.ReadAt, out.BasisNote)
	}
}

func TestOrderSearchKeepsPlacesAndTheLimitKeepsTheTotal(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	all := a.Order(orderQuery{position: draft.WR, limit: MaxOrderRows}, false)
	found := a.Order(orderQuery{position: draft.WR, q: "player 1", limit: MaxOrderRows}, false)
	if len(found.Rows) == 0 || len(found.Rows) >= len(all.Rows) {
		t.Fatalf("search kept %d of %d", len(found.Rows), len(all.Rows))
	}
	place := map[string]int{}
	for _, row := range all.Rows {
		place[*row.Line.Player.BoardId] = row.Rank
	}
	for _, row := range found.Rows {
		if !strings.Contains(strings.ToLower(row.Line.Player.Name), "player 1") || place[*row.Line.Player.BoardId] != row.Rank {
			t.Fatalf("%s at %d, in the order at %d", row.Line.Player.Name, row.Rank, place[*row.Line.Player.BoardId])
		}
	}
	limited := a.Order(orderQuery{position: draft.WR, limit: 5}, false)
	if len(limited.Rows) != 5 || limited.Total != len(all.Rows) {
		t.Fatalf("limit 5: %d rows of %d", len(limited.Rows), limited.Total)
	}
}

func TestOrderOnThePreseasonOrderCarriesNoRestOfSeasonTotal(t *testing.T) {
	f := newFixture(t)
	out := newFixtureAdvisor(t, f, nil).Order(orderQuery{position: draft.QB, limit: MaxOrderRows}, true)
	for _, row := range out.Rows {
		if row.RestOfSeasonPoints != nil {
			t.Fatalf("%s carries a rest-of-season total on the preseason order", row.Line.Player.Name)
		}
	}
	if out.FromWeek != nil || !strings.HasPrefix(out.Basis, "Our preseason order") {
		t.Fatalf("from week %v, basis %q", out.FromWeek, out.Basis)
	}
}

type fakeBoards struct {
	board boards.Board
	asked apitypes.LeagueSettings
}

func (f *fakeBoards) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	f.asked = s
	return f.board, nil
}

func TestOrderRoutes(t *testing.T) {
	f := restOfSeasonFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	public := &fakeBoards{board: f.league.Board}
	s.Boards, s.Season = public, 2026
	code, env := serve(t, s, "/order?position=TE&limit=3")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("public: %d %+v", code, env.Error)
	}
	var out apitypes.OrderAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Rows) != 3 || out.Rows[0].Roster != nil || out.ReadAt != nil || out.Week != 6 {
		t.Fatalf("public: %d rows, roster %v, read at %v, week %d", len(out.Rows), out.Rows[0].Roster, out.ReadAt, out.Week)
	}
	if public.asked.Teams != 12 || public.asked.Scoring.Preset == nil || *public.asked.Scoring.Preset != apitypes.ScoringPresetPpr {
		t.Fatalf("valued for %+v", public.asked)
	}
	code, env = serve(t, s, leaguePath+"order?position=RB")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("league: %d %+v", code, env.Error)
	}
	for _, bad := range []struct{ path, field string }{
		{"/order?position=LB", fieldPosition}, {"/order?q=a", fieldQuery}, {"/order?limit=0", fieldLimit},
		{"/order?limit=401", fieldLimit}, {leaguePath + "order?q=" + strings.Repeat("x", 41), fieldQuery},
	} {
		code, env := serve(t, s, bad.path)
		if code != http.StatusBadRequest || env.Error == nil || env.Error.Fields[bad.field] == "" {
			t.Fatalf("%s: %d %+v", bad.path, code, env.Error)
		}
	}
}
