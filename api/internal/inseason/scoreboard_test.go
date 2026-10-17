package inseason

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

func scoreboardOf(t *testing.T, s *Service) apitypes.Scoreboard {
	t.Helper()
	code, env := serve(t, s, leaguePath+"scoreboard")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("scoreboard: %d %+v", code, env.Error)
	}
	var board apitypes.Scoreboard
	if err := json.Unmarshal(env.Data, &board); err != nil {
		t.Fatal(err)
	}
	return board
}

// Every game of the week comes back, the drafter's first with their side
// first though the host lists the opponent ahead, a team with no game on
// its own; each side's projection is its starters' as the matchup box
// prints them, summed, and its points and starters are the host's.
func TestScoreboardIsEveryGameWithTheMatchupsProjection(t *testing.T) {
	f := pairedFixture(t)
	f.league.Snap.Matchups[0], f.league.Snap.Matchups[1] = f.league.Snap.Matchups[1], f.league.Snap.Matchups[0]
	f.league.Snap.Matchups[0].Points = 41.5
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	board := scoreboardOf(t, s)
	if board.Week != 6 || len(board.Games) != 2 {
		t.Fatalf("games %+v", board.Games)
	}
	mine := board.Games[0]
	if len(mine.Sides) != 2 || mine.Sides[0].RosterId != 1 || mine.Sides[1].RosterId != 2 || mine.Sides[1].Points != 41.5 {
		t.Fatalf("the drafter's game %+v", mine.Sides)
	}
	if alone := board.Games[1]; len(alone.Sides) != 1 || alone.Sides[0].RosterId != 3 || alone.Sides[0].Projection != nil {
		t.Errorf("the team with no starters %+v", alone.Sides)
	}
	box := matchupOf(t, s)
	for i, side := range box.Sides {
		sum, projected := 0.0, false
		for _, st := range side.Starters {
			if st.Line.WeekProjection != nil {
				sum += roundTenth(*st.Line.WeekProjection)
				projected = true
			}
		}
		got := mine.Sides[i]
		if !projected {
			if got.Projection != nil {
				t.Errorf("side %d projection %v with no starter projected", got.RosterId, *got.Projection)
			}
			continue
		}
		if got.Projection == nil || *got.Projection != roundTenth(sum) {
			t.Errorf("side %d projection %v, want %v", got.RosterId, got.Projection, roundTenth(sum))
		}
		if got.Starters != len(side.Starters) || !got.PointsRead {
			t.Errorf("side %d starters %d, read %v", got.RosterId, got.Starters, got.PointsRead)
		}
	}
	if board.ProjectionReadAt == nil || !board.ProjectionReadAt.Equal(projectionAt) {
		t.Errorf("projection read at %v", board.ProjectionReadAt)
	}
}

// A game is upcoming until a starter's game kicks off, playing while any
// is still to finish, final once every one has; a bye counts for neither,
// and the next kickoff is the earliest still to come.
func TestScoreboardGameState(t *testing.T) {
	now := time.Date(2026, 10, 18, 18, 0, 0, 0, time.UTC)
	at := func(h int) *time.Time {
		k := time.Date(2026, 10, 18, h, 0, 0, 0, time.UTC)
		return &k
	}
	cases := []struct {
		name  string
		facts []apitypes.WeekFacts
		want  apitypes.ScoreboardGameState
		next  *time.Time
	}{
		{"before kickoff", []apitypes.WeekFacts{{Kickoff: at(20)}, {Kickoff: at(21)}, {Bye: true}}, apitypes.ScoreboardGameStateUpcoming, at(20)},
		{"one kicked off", []apitypes.WeekFacts{{Kickoff: at(17)}, {Kickoff: at(21)}}, apitypes.ScoreboardGameStatePlaying, at(21)},
		{"one final, none to come", []apitypes.WeekFacts{{Kickoff: at(13), Played: true}, {Kickoff: at(17)}}, apitypes.ScoreboardGameStatePlaying, nil},
		{"every one final", []apitypes.WeekFacts{{Kickoff: at(13), Played: true}, {Kickoff: at(17), Played: true}, {Bye: true}}, apitypes.ScoreboardGameStateFinal, nil},
		{"nobody plays", []apitypes.WeekFacts{{Bye: true}}, apitypes.ScoreboardGameStateUpcoming, nil},
	}
	for _, c := range cases {
		var k kickoffs
		for _, f := range c.facts {
			k.add(f, now)
		}
		if k.state() != c.want {
			t.Errorf("%s: %s, want %s", c.name, k.state(), c.want)
		}
		if (k.next == nil) != (c.next == nil) || (k.next != nil && !k.next.Equal(*c.next)) {
			t.Errorf("%s: next %v, want %v", c.name, k.next, c.next)
		}
	}
}

// A side whose score the host could not read says so.
func TestScoreboardKeepsAnUnreadScore(t *testing.T) {
	f := pairedFixture(t)
	f.league.Snap.Matchups = []leaguesync.Side{{RosterID: 1, Game: 0, PointsUnread: true}}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	board := scoreboardOf(t, s)
	if len(board.Games) != 1 || board.Games[0].Sides[0].PointsRead {
		t.Errorf("games %+v", board.Games)
	}
}
