package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// B209 (Lane 227): with byes=last every row keeps the number the order
// without it gives him (overall_rank), so the Rankings, home, the club
// page and compare print one number; rank stays the answer's 1..n. The
// fixture's byes sit inside the order's top ten, so the numbers differ
// from the first bye down; a position whose players all play keeps both
// equal.
func TestByesLastKeepsEachPlayersFullOrderNumber(t *testing.T) {
	a := byesInTheTopTen(t)
	allPlay := false
	for _, position := range []draft.Position{"", draft.QB, draft.RB, draft.WR, draft.TE} {
		plain := a.Order(orderQuery{position: position, limit: MaxOrderRows}, nil)
		week := a.Order(orderQuery{position: position, limit: MaxOrderRows, byesLast: true}, nil)
		full := map[string]int{}
		for i, row := range plain.Rows {
			if row.OverallRank == nil || *row.OverallRank != row.Rank || row.Rank != i+1 {
				t.Fatalf("%q without byes: %s rank %d, overall %v", position, row.Line.Player.Name, row.Rank, row.OverallRank)
			}
			full[*row.Line.Player.BoardId] = row.Rank
		}
		byeInTopTen, differ := false, 0
		for _, row := range week.Rows {
			want := full[*row.Line.Player.BoardId]
			if row.OverallRank == nil || *row.OverallRank != want {
				t.Fatalf("%q byes=last: %s overall %v, the full order's %d", position, row.Line.Player.Name, row.OverallRank, want)
			}
			if *row.OverallRank != row.Rank {
				differ++
			}
			if isBye(row) && want <= 10 {
				byeInTopTen = true
			}
		}
		t.Logf("%q: %d rows, %d differ, a bye in the top ten %v", position, len(week.Rows), differ, byeInTopTen)
		switch {
		case position == "" && !byeInTopTen:
			t.Fatal("no bye in the top ten across positions: the test proves nothing")
		case byeInTopTen && differ == 0:
			t.Fatalf("%q: a bye in the top ten and every row's two numbers equal", position)
		case !byeAheadOfAPlayer(plain.Rows) && differ != 0:
			t.Fatalf("%q: every player plays or the byes sit last already, and %d rows' numbers differ", position, differ)
		case !byeAheadOfAPlayer(plain.Rows):
			allPlay = true
		}
	}
	if !allPlay {
		t.Fatal("no position where the byes already sit last: the equal case is untested")
	}
}

// byesInTopTenIDs are the order's 2nd and 5th across positions, moved to
// a club on bye in the fixture's week by byesInTheTopTen.
var byesInTopTenIDs = []int{2, 5}

// byesInTheTopTen is the rest-of-season fixture with two of the order's
// top five across positions on a club on bye in its week, so byes=last
// moves players out of the top ten.
func byesInTheTopTen(t *testing.T) *advisor {
	t.Helper()
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	bye := ""
	for _, p := range f.raw.Players {
		if a.season.OnBye(p.Team) {
			bye = p.Team
			break
		}
	}
	if bye == "" {
		t.Fatal("the fixture's week has no club on bye")
	}
	plain := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	moved := map[string]bool{}
	for _, place := range byesInTopTenIDs {
		moved[*plain.Rows[place-1].Line.Player.BoardId] = true
	}
	everyonePlays := map[draft.Position]bool{draft.QB: true, draft.RB: true, draft.WR: true, draft.TE: true}
	plays := ""
	for _, p := range f.raw.Players {
		if moved[p.ID] {
			delete(everyonePlays, p.Position)
		}
		if p.Team != "" && !a.season.OnBye(p.Team) && plays == "" {
			plays = p.Team
		}
	}
	for i, p := range f.raw.Players {
		switch {
		case moved[p.ID]:
			f.raw.Players[i].Team = bye
		case everyonePlays[p.Position] && a.season.OnBye(p.Team):
			f.raw.Players[i].Team = plays
		}
	}
	if len(everyonePlays) == 0 {
		t.Fatal("no position left whose players all play")
	}
	f = rebuilt(t, f)
	return newFixtureAdvisor(t, f, nil)
}

// rebuilt is the fixture's board valued again from its raw players.
func rebuilt(t *testing.T, f fixture) fixture {
	t.Helper()
	config, err := mock.SlotConfig(*f.league.Saved)
	if err != nil {
		t.Fatal(err)
	}
	if f.league.Board, err = boards.For(f.raw, f.league.Saved.Teams, config); err != nil {
		t.Fatal(err)
	}
	return f
}

// A league's order reads no byes: every row's overall_rank is its rank.
func TestALeaguesOrderRowsCarryTheirRankAsOverall(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	for _, row := range a.Order(orderQuery{limit: MaxOrderRows}, onceTargets(a)).Rows {
		if row.OverallRank == nil || *row.OverallRank != row.Rank {
			t.Fatalf("%s: rank %d, overall %v", row.Line.Player.Name, row.Rank, row.OverallRank)
		}
	}
}
