package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// onBye is a placed player at a card position whose club is on bye in
// week 6 (the fixture's last two clubs).
func onBye(t *testing.T, f fixture) boards.Player {
	t.Helper()
	for _, p := range f.raw.Players {
		if p.Team == "TEN" && cardPositions[p.Position] {
			return p
		}
	}
	t.Fatal("no TEN player in the fixture")
	return boards.Player{}
}

// On his bye the public read carries his club's next game: its week, the
// opponent, and while no projection is read for it, when one will be.
func TestThePublicReadOnHisByeCarriesHisNextGame(t *testing.T) {
	f := newFixture(t)
	data := withWeekSeven(f.data)
	s := fixtureService(t, f.league, data, &fakeHolds{})
	s.Season = 2026
	s.Boards = fakeBoards{board: f.league.Board}
	bp := onBye(t, f)
	out := playerWeekOf(t, s, "/players/"+bp.ID+"/week")
	if !out.Line.Facts.Bye || out.AfterBye == nil {
		t.Fatalf("bye %v after %+v", out.Line.Facts.Bye, out.AfterBye)
	}
	next := out.AfterBye
	if next.Week != 7 || next.Line.Facts.Bye || next.Line.Facts.Opponent == nil || *next.Line.Facts.Opponent != "WSH" {
		t.Fatalf("the next game: week %d %+v", next.Week, next.Line.Facts)
	}
	want := weekSevenFirst.Add(-ProjectionCaptureLead)
	if next.ProjectionReadAt != nil || next.ProjectionArrivesAt == nil || !next.ProjectionArrivesAt.Equal(want) {
		t.Fatalf("no week 7 projection read: arrives %v, read %v", next.ProjectionArrivesAt, next.ProjectionReadAt)
	}
	// A player who plays this week carries none.
	playing := playerWeekOf(t, s, "/players/"+f.raw.Players[0].ID+"/week")
	if playing.Line.Facts.Bye || playing.AfterBye != nil {
		t.Fatalf("a player with a game: %+v", playing.AfterBye)
	}
}

// With a league the next game is read in the league's scoring, the
// advisor turned to that week; with no game left there is none.
func TestTheLeagueReadOnHisByeCarriesHisNextGame(t *testing.T) {
	f := newFixture(t)
	bp := onBye(t, f)
	s := fixtureService(t, f.league, withWeekSeven(f.data), &fakeHolds{})
	out := playerWeekOf(t, s, leaguePath+"players/"+bp.ID)
	if out.AfterBye == nil || out.AfterBye.Week != 7 || out.AfterBye.Line.Facts.Opponent == nil {
		t.Fatalf("after bye %+v", out.AfterBye)
	}
	s = fixtureService(t, f.league, f.data, &fakeHolds{})
	if got := playerWeekOf(t, s, leaguePath+"players/"+bp.ID); !got.Line.Facts.Bye || got.AfterBye != nil {
		t.Fatalf("no game after the bye: %+v", got.AfterBye)
	}
}
