package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// onHost is the host-shaped fixture after kickoff read from another
// platform.
func onHost(t *testing.T, host string) fixture {
	t.Helper()
	f := hostShaped(t, true)
	f.league.Snap.Ref.Host = host
	return f
}

// Lane 79: the answers read the per-platform rule (leaguesync
// GivesPlayerPoints). ESPN now sends each player's week points, so its
// box score and Lineup say so and carry them; a platform that sends each
// team's total alone (Yahoo) prints none, whatever its read holds.
func TestTheAnswersReadThePerPlatformRule(t *testing.T) {
	for _, c := range []struct {
		host string
		want bool
	}{{leaguesync.HostESPN, true}, {leaguesync.HostSleeper, true}, {leaguesync.HostYahoo, false}, {leaguesync.HostFFPC, false}} {
		f := onHost(t, c.host)
		a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, sundayAfternoon)
		if err != nil {
			t.Fatal(err)
		}
		lineup, _ := a.Lineup()
		box, _ := a.Matchup()
		if lineup.PlayerPoints != c.want || box.Sides[0].PlayerPoints != c.want || box.Sides[1].PlayerPoints != c.want {
			t.Fatalf("%s: lineup %v, sides %v %v", c.host, lineup.PlayerPoints, box.Sides[0].PlayerPoints, box.Sides[1].PlayerPoints)
		}
		qb := box.Sides[0].Starters[0].Line.Facts.PointsThisWeek
		if c.want != (qb != nil) || (qb != nil && *qb != 8.7) {
			t.Fatalf("%s: the quarterback's points %v", c.host, qb)
		}
		if lineup.TeamPoints == nil || *lineup.TeamPoints != 87.4 {
			t.Fatalf("%s: the team's points %v", c.host, lineup.TeamPoints)
		}
		// Ruling (a): the platform's own total is the score on ESPN, Yahoo
		// and FFPC; Sleeper's is its players' points added.
		if total := c.host != leaguesync.HostSleeper; box.Sides[0].TeamTotal != total || box.Sides[1].TeamTotal != total {
			t.Fatalf("%s: team total %v %v", c.host, box.Sides[0].TeamTotal, box.Sides[1].TeamTotal)
		}
	}
}

// The scoreboard's side is ESPN's own total (Lane 74), never a sum of
// its players' points: the two differ here, and the card shows ESPN's.
func TestTheScoreboardShowsESPNsTotalNotThePlayersSum(t *testing.T) {
	f := onHost(t, leaguesync.HostESPN)
	side := f.league.Snap.Matchups[0]
	sum := 0.0
	for _, id := range side.Starters {
		sum += roundTenth(side.PlayerPoints[id])
	}
	if roundTenth(sum) == 87.4 {
		t.Fatal("the fixture's players sum to ESPN's total: nothing to tell apart")
	}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	board := scoreboardOf(t, s)
	for _, g := range board.Games {
		for _, got := range g.Sides {
			if got.Points != 87.4 {
				t.Fatalf("side %d shows %v, not ESPN's 87.4 (the players sum to %v)", got.RosterId, got.Points, roundTenth(sum))
			}
		}
	}
}
