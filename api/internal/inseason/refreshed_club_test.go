package inseason

import (
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// The card head names the club the board reads for him (Lane 122): once
// the daily list has moved him, the board's club is the new one
// (boards.TestARefreshedClubReachesTheBoard), and his week is that
// club's game or that club's bye, never his old club's.
func TestTheCardHeadReadsTheRefreshedClub(t *testing.T) {
	for _, tc := range []struct {
		club, opponent string
		bye            bool
	}{
		{club: "DAL", opponent: "DEN"}, // week 6 pairs DAL with DEN
		{club: "TEN", bye: true},       // the fixture's week 6 bye
	} {
		f := newFixture(t)
		before := f.raw.Players[0]
		if before.Team != "ARI" {
			t.Fatalf("the fixture's first player plays for %s, want ARI", before.Team)
		}
		raw := *f.raw
		raw.Players = slices.Clone(f.raw.Players)
		raw.Players[0].Team = tc.club
		settings := fixtureSettings()
		config, err := mock.SlotConfig(settings)
		if err != nil {
			t.Fatal(err)
		}
		board, err := boards.For(&raw, settings.Teams, config)
		if err != nil {
			t.Fatal(err)
		}
		s := fixtureService(t, f.league, f.data, &fakeHolds{})
		s.Season = 2026
		s.Facts = fakeFacts{data: f.data, projection: boards.WeekProjection{}}
		s.Boards = fakeBoards{board: board}
		out := playerWeekOf(t, s, "/players/"+before.ID+"/week")
		if out.Week != 6 || out.Line.Player.Team != tc.club {
			t.Fatalf("%s: week %d club %q, want week 6 and the refreshed club", tc.club, out.Week, out.Line.Player.Team)
		}
		facts := out.Line.Facts
		if tc.bye {
			if !facts.Bye || facts.Opponent != nil {
				t.Fatalf("%s: facts %+v, want his new club's bye", tc.club, facts)
			}
			continue
		}
		if facts.Bye || facts.Opponent == nil || *facts.Opponent != tc.opponent {
			t.Fatalf("%s: facts %+v, want the new club's game against %s, not ARI's against ATL", tc.club, facts, tc.opponent)
		}
	}
}
