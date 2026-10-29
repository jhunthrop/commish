package inseason

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

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
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{position: draft.RB, limit: MaxOrderRows}, a.tradeTargets)
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

func TestOrderAcrossPositionsRanksByValueAndCarriesNoKickerOrDefense(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	if len(out.Rows) == 0 {
		t.Fatal("no rows")
	}
	for i, row := range out.Rows {
		if row.Rank != i+1 {
			t.Fatalf("row %d ranks %d", i, row.Rank)
		}
		// The in-season table carries no K or DEF rows (Lane 66m), and the order follows it.
		if p := row.Line.Player.Position; p == string(draft.K) || p == string(draft.DEF) {
			t.Fatalf("%s is a %s", row.Line.Player.Name, p)
		}
		if row.RestOfSeasonPoints == nil {
			t.Fatalf("%s carries no total", row.Line.Player.Name)
		}
		if i > 0 {
			prev, cur := *out.Rows[i-1].Line.Player.BoardId, *row.Line.Player.BoardId
			if a.Board.Values[cur] > a.Board.Values[prev] {
				t.Fatalf("%s outvalues the row above", row.Line.Player.Name)
			}
		}
		if row.Roster != nil || row.Move != nil {
			t.Fatalf("%s carries a roster or a move without marks", row.Line.Player.Name)
		}
	}
	if out.ReadAt != nil {
		t.Fatalf("read at %v", out.ReadAt)
	}
}

func TestOrderMarksRostersAndTheMoveARowAdmits(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	targets := a.tradeTargets()
	if len(targets) == 0 {
		t.Fatal("the finder brings in nobody, so the test proves nothing")
	}
	out := a.Order(orderQuery{limit: MaxOrderRows}, a.tradeTargets)
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
	all := a.Order(orderQuery{position: draft.WR, limit: MaxOrderRows}, nil)
	found := a.Order(orderQuery{position: draft.WR, q: "player 1", limit: MaxOrderRows}, nil)
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
	limited := a.Order(orderQuery{position: draft.WR, limit: 5}, nil)
	if len(limited.Rows) != 5 || limited.Total != len(all.Rows) {
		t.Fatalf("limit 5: %d rows of %d", len(limited.Rows), limited.Total)
	}
}

func TestOrderOnThePreseasonOrderCarriesNoRestOfSeasonTotal(t *testing.T) {
	f := newFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{position: draft.QB, limit: MaxOrderRows}, a.tradeTargets)
	for _, row := range out.Rows {
		if row.RestOfSeasonPoints != nil {
			t.Fatalf("%s carries a rest-of-season total on the preseason order", row.Line.Player.Name)
		}
	}
	if out.FromWeek != nil || !strings.HasPrefix(out.Basis, "Our preseason order") {
		t.Fatalf("from week %v, basis %q", out.FromWeek, out.Basis)
	}
}

// askingBoards answers the public order's board and keeps the settings it was asked for.
type askingBoards struct {
	board boards.Board
	asked apitypes.LeagueSettings
}

func (f *askingBoards) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	f.asked = s
	return f.board, nil
}

func TestOrderRoutes(t *testing.T) {
	f := restOfSeasonFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	public := &askingBoards{board: f.league.Board}
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
		{"/order?position=LB", fieldPosition}, {"/order?position=K", fieldPosition}, {"/order?position=DEF", fieldPosition}, {"/order?q=a", fieldQuery}, {"/order?limit=0", fieldLimit},
		{"/order?limit=401", fieldLimit}, {leaguePath + "order?q=" + strings.Repeat("x", 41), fieldQuery},
	} {
		code, env := serve(t, s, bad.path)
		if code != http.StatusBadRequest || env.Error == nil || env.Error.Fields[bad.field] == "" {
			t.Fatalf("%s: %d %+v", bad.path, code, env.Error)
		}
	}
}

func TestOrderSaysWhatItsRankSortsOnAndCarriesBothKeys(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	all := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	if all.RankBy != apitypes.OrderAdviceRankByPointsOverReplacement {
		t.Fatalf("all ranks by %s", all.RankBy)
	}
	for i, row := range all.Rows {
		if row.PointsOverReplacement == nil {
			break // kickers and defenses, last
		}
		if i > 0 && all.Rows[i-1].PointsOverReplacement != nil && *row.PointsOverReplacement > *all.Rows[i-1].PointsOverReplacement {
			t.Fatalf("row %d's points over replacement %v top the row above's", i, *row.PointsOverReplacement)
		}
	}
	rb := a.Order(orderQuery{position: draft.RB, limit: MaxOrderRows}, nil)
	if rb.RankBy != apitypes.OrderAdviceRankByRestOfSeasonPoints {
		t.Fatalf("RB ranks by %s", rb.RankBy)
	}
	// The league shape is said once, in the basis (Lane 66q); the note is the rules points so far leave out.
	if !strings.Contains(all.Basis, "less a free pickup's in a 12-team PPR league.") || strings.Contains(all.BasisNote, "12-team") {
		t.Fatalf("the basis %q and note %q name the league shape other than once", all.Basis, all.BasisNote)
	}
}

func TestOrderFiltersByRosterBeforeTheLimit(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	free := a.Order(orderQuery{roster: apitypes.RosterMarkKindFree, limit: 3}, a.tradeTargets)
	if len(free.Rows) != 3 || free.Total <= 3 {
		t.Fatalf("free: %d rows of %d", len(free.Rows), free.Total)
	}
	for _, row := range free.Rows {
		if row.Roster.Kind != apitypes.RosterMarkKindFree {
			t.Fatalf("%s is %s", row.Line.Player.Name, row.Roster.Kind)
		}
	}
	yours := a.Order(orderQuery{roster: apitypes.RosterMarkKindYours, limit: MaxOrderRows}, a.tradeTargets)
	for _, row := range yours.Rows {
		if row.Roster.Kind != apitypes.RosterMarkKindYours {
			t.Fatalf("%s is %s", row.Line.Player.Name, row.Roster.Kind)
		}
	}
	if yours.Total == 0 || yours.Total != len(yours.Rows) {
		t.Fatalf("yours: %d of %d", len(yours.Rows), yours.Total)
	}
}

func TestTheFinderRunsOncePerLeagueRead(t *testing.T) {
	f := restOfSeasonFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	a := newFixtureAdvisor(t, f, nil)
	runs := 0
	find := func() (map[int]Found, error) { runs++; return a.findAll(context.Background()) }
	get := func(b *advisor, account string) {
		t.Helper()
		if _, err := s.finds.get(pairKey(b, account), contentKey(b), find); err != nil {
			t.Fatal(err)
		}
	}
	for range 3 {
		get(a, "acct")
	}
	if runs != 1 {
		t.Fatalf("the finder ran %d times for one read", runs)
	}
	// A new read whose rosters, holds, projection and order are unchanged
	// keeps the search (rereview 66u W1): the read time alone changes nothing.
	moved := *a
	moved.Snap.ReadAt = moved.Snap.ReadAt.Add(time.Minute)
	get(&moved, "acct")
	if runs != 1 {
		t.Fatalf("an unchanged read ran the finder again (%d runs)", runs)
	}
	// The drop follows this week's lineup, so a new projection read is a
	// new search (Lane 66u N3), and it replaces the pair's last.
	projected := *a
	projected.projection.ReadAt = projected.projection.ReadAt.Add(time.Minute)
	get(&projected, "acct")
	if runs != 2 || len(s.finds.pairs) != 1 {
		t.Fatalf("a new projection read: %d runs, %d pairs kept", runs, len(s.finds.pairs))
	}
	// Another account is another pair (rereview 66u W6).
	get(&projected, "other")
	if runs != 3 || len(s.finds.pairs) != 2 {
		t.Fatalf("another account: %d runs, %d pairs kept", runs, len(s.finds.pairs))
	}
	// A changed hold is changed content.
	held := projected
	held.held = map[string]bool{"p001": true}
	if contentKey(&held) == contentKey(&projected) {
		t.Fatal("a hold leaves the content unchanged")
	}
	get(&held, "other")
	if runs != 4 {
		t.Fatalf("a changed hold ran the finder %d times in all", runs)
	}
	// A view with no row on another roster never runs it.
	asked := 0
	only := a.Order(orderQuery{roster: apitypes.RosterMarkKindYours, limit: MaxOrderRows}, func() map[string]bool { asked++; return nil })
	if asked != 0 || len(only.Rows) == 0 {
		t.Fatalf("the finder ran %d times for the drafter's own rows", asked)
	}
}

func TestOrderRoutesCarryTheClaimMovesAndRefuseARosterWithoutALeague(t *testing.T) {
	f := restOfSeasonFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Boards, s.Season = fakeBoards{board: f.league.Board}, 2026
	code, env := serve(t, s, leaguePath+"order?roster=free&limit=2")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("league: %d %+v", code, env.Error)
	}
	var out apitypes.OrderAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	if out.Moves == nil || out.Moves.Claim != apitypes.WaiverMovesClaimUnavailable || out.Moves.Reason == nil {
		t.Fatalf("moves %+v", out.Moves)
	}
	code, env = serve(t, s, "/order?roster=free")
	if code != http.StatusBadRequest || env.Error == nil || env.Error.Fields[fieldRoster] == "" {
		t.Fatalf("public roster: %d %+v", code, env.Error)
	}
	code, env = serve(t, s, "/order")
	if code != http.StatusOK {
		t.Fatalf("public: %d", code)
	}
	var public apitypes.OrderAdvice
	if err := json.Unmarshal(env.Data, &public); err != nil {
		t.Fatal(err)
	}
	if public.Moves != nil {
		t.Fatalf("public moves %+v", public.Moves)
	}
}

// Lane 165 (D12): the count of players on a club's roster leaves out the players with no club (free
// agents and retired players, the daily list's NULL club) and is the total with none of them.
func TestOrderCountsThePlayersOnAClubsRoster(t *testing.T) {
	f := newFixture(t)
	f.raw.Order, f.raw.FromWeek = boards.OrderRestOfSeason, 6
	cleared := 0
	for i := range f.raw.Players {
		if f.raw.Players[i].Position == draft.WR && cleared < 2 {
			f.raw.Players[i].Team, f.raw.Players[i].Bye = "", 0
			cleared++
		}
	}
	config, err := mock.SlotConfig(*f.league.Saved)
	if err != nil {
		t.Fatal(err)
	}
	if f.league.Board, err = boards.For(f.raw, f.league.Saved.Teams, config); err != nil {
		t.Fatal(err)
	}
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{position: draft.WR, limit: 5}, nil)
	if out.OnClub == nil || *out.OnClub != out.Total-cleared {
		t.Fatalf("on club %v of %d with %d cleared", out.OnClub, out.Total, cleared)
	}
}
