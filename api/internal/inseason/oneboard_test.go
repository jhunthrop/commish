package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// One board (Lane 96 fix round 1, B08): between the run and the next one,
// once a game has kicked off, the order every signed-in screen prints (the
// front door's strip, /board and Players) is the board at the read's
// clock. The fixture's run is Wednesday's, from week 6; ARI and ATL play
// Thursday night and the clock is Friday noon. Through the engine, every
// row's Over repl. and Projected are the live board's to the tenth, the
// league's read and the read with no league's alike, and the Thursday
// clubs' points are the run's less the game they played.
func TestEverySignedInScreenReadsTheBoardAtTheClock(t *testing.T) {
	f := restFixture(t)
	run := time.Date(2026, 10, 14, 5, 0, 0, 0, time.UTC)
	thursday := time.Date(2026, 10, 15, 20, 15, 0, 0, east)
	friday := time.Date(2026, 10, 16, 12, 0, 0, 0, east)
	f.league.Board.FromWeek, f.league.Board.Refreshed = 6, run
	games := make([]boards.TeamWeek, 0, len(f.data.Games))
	for _, g := range f.data.Games {
		if g.Week == 6 && (g.Team == "ARI" || g.Team == "ATL") {
			g.Kickoff = thursday
		}
		games = append(games, g)
	}
	f.data.Games = games
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, friday, nil)
	if err != nil {
		t.Fatal(err)
	}
	none := map[string]bool{}
	public := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	league := a.Order(orderQuery{limit: MaxOrderRows}, func() map[string]bool { return none })
	if len(public.Rows) == 0 || len(public.Rows) != len(league.Rows) {
		t.Fatalf("rows: %d with no league, %d in the league", len(public.Rows), len(league.Rows))
	}
	for i, row := range public.Rows {
		id := boardID(row.Line)
		live, _ := a.Board.Player(id)
		runPlayer, _ := f.league.Board.Player(id)
		v := a.Board.Values[id]
		if row.PointsOverReplacement == nil || *row.PointsOverReplacement != roundTenth(v) ||
			row.RestOfSeasonPoints == nil || *row.RestOfSeasonPoints != roundTenth(*live.Points) {
			t.Fatalf("%s: Over repl. %v and Projected %v, the live board's %v and %v", id, row.PointsOverReplacement, row.RestOfSeasonPoints, v, *live.Points)
		}
		other := league.Rows[i]
		if boardID(other.Line) != id || *other.PointsOverReplacement != *row.PointsOverReplacement || *other.RestOfSeasonPoints != *row.RestOfSeasonPoints {
			t.Fatalf("row %d: %s %v in the league, %s %v with none", i, boardID(other.Line), other.PointsOverReplacement, id, row.PointsOverReplacement)
		}
		if runPlayer.Team == "ARI" || runPlayer.Team == "ATL" {
			// Twelve games at the run (weeks 6 to 17), eleven left once Thursday's has kicked off.
			if want := *runPlayer.Points * 11 / 12; *live.Points != want {
				t.Fatalf("%s (%s): live %v, want %v", id, runPlayer.Team, *live.Points, want)
			}
		} else if *live.Points != *runPlayer.Points {
			t.Fatalf("%s (%s) has not played: live %v, run %v", id, runPlayer.Team, *live.Points, *runPlayer.Points)
		}
	}
}
