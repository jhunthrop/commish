package inseason

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// liveSunday is the fixture's week 6 at 3:00 pm Eastern on Sunday: every
// game final but CIN at CLE (in play) and DAL at DEN (moved to Monday).
var liveSunday = time.Date(2026, 10, 18, 15, 0, 0, 0, east)

// liveFixture is the paired fixture on that Sunday. Team 1 (the member)
// starts h001 (CLE, in play) and eight others final or on bye; team 2
// starts h015 (DEN) and h024 (the DAL defense), both still to play.
func liveFixture(t *testing.T) (fixture, boards.WeekProjection) {
	t.Helper()
	f := pairedFixture(t)
	monday := time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	for i, g := range f.data.Games {
		if g.Week != 6 {
			continue
		}
		switch g.Team {
		case "CIN", "CLE":
		case "DAL", "DEN":
			f.data.Games[i].Kickoff = monday
		default:
			f.data.Games[i].Final = true
		}
	}
	f.league.Snap.Matchups[0].Points = 50
	f.league.Snap.Matchups[1].Points = 40
	projection := weekProjection(f)
	projection.Players["p015"] = boards.ProjectedPoints{PPR: 18.04, Half: 17, Standard: 16}
	return f, projection
}

func liveService(t *testing.T, f fixture, projection boards.WeekProjection) *Service {
	t.Helper()
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: projection}
	s.Now = func() time.Time { return liveSunday }
	return s
}

// Once a game is under way each side says where its starters stand, never
// a zero (B02), and carries its projected final (B22): its score so far
// plus the Proj of its starters still to play, by one rule for the bug,
// the Matchup and the Lineup.
func TestLiveCardCountsEachSideAndProjectsItsFinal(t *testing.T) {
	f, projection := liveFixture(t)
	s := liveService(t, f, projection)
	board := scoreboardOf(t, s)
	game := board.Games[0]
	if game.State != apitypes.ScoreboardGameStatePlaying {
		t.Fatalf("state %s", game.State)
	}
	mine, theirs := game.Sides[0], game.Sides[1]
	if mine.ToPlay == nil || *mine.ToPlay != "1 playing" {
		t.Errorf("the member's side %v, want 1 playing", mine.ToPlay)
	}
	if theirs.ToPlay == nil || *theirs.ToPlay != "2 to play" {
		t.Errorf("the opponent's side %v, want 2 to play", theirs.ToPlay)
	}
	if game.ToPlay == nil || *game.ToPlay != "2 to play" {
		t.Errorf("the pooled count %v, want 2 to play", game.ToPlay)
	}
	if mine.ProjectedFinal == nil || *mine.ProjectedFinal != 50 {
		t.Errorf("the member's projected final %v, want 50 (nothing still to play)", mine.ProjectedFinal)
	}
	// 40 so far, 18.0 for h015 and the DAL defense's 7 still to play.
	if theirs.ProjectedFinal == nil || *theirs.ProjectedFinal != 65 {
		t.Errorf("the opponent's projected final %v, want 65", theirs.ProjectedFinal)
	}
	box := matchupOf(t, s)
	for i, side := range box.Sides {
		want := game.Sides[i].ProjectedFinal
		if side.ProjectedFinal == nil || want == nil || *side.ProjectedFinal != *want {
			t.Errorf("matchup side %d projected final %v, the bug's %v", side.RosterId, side.ProjectedFinal, want)
		}
	}
	lineup := lineupOf(t, s)
	if lineup.ProjectedFinal == nil || *lineup.ProjectedFinal != 50 {
		t.Errorf("the lineup's projected final %v, want 50", lineup.ProjectedFinal)
	}
}

// Before any kickoff no side has a projected final or a count: the Proj
// is the figure.
func TestLiveCardBeforeKickoffHasNoProjectedFinal(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	game := scoreboardOf(t, s).Games[0]
	for _, side := range game.Sides {
		if side.ProjectedFinal != nil || side.ToPlay != nil {
			t.Errorf("side %d before kickoff: final %v, count %v", side.RosterId, side.ProjectedFinal, side.ToPlay)
		}
	}
	if lineup := lineupOf(t, s); lineup.ProjectedFinal != nil {
		t.Errorf("the lineup before kickoff %v", *lineup.ProjectedFinal)
	}
}

// A side whose last starter in play is out is done (B02, the FFPC card):
// it says nothing, and the game reads final once the other side is too.
func TestLiveCardOutStarterLeavesTheSideDone(t *testing.T) {
	f, projection := liveFixture(t)
	f.data.Designations = map[string]boards.Designation{"p001": {Code: "O", AsOf: liveSunday.Add(-48 * time.Hour)}}
	s := liveService(t, f, projection)
	game := scoreboardOf(t, s).Games[0]
	if game.Sides[0].ToPlay != nil {
		t.Errorf("the member's side with its last starter out says %q", *game.Sides[0].ToPlay)
	}
	if game.State != apitypes.ScoreboardGameStatePlaying {
		t.Errorf("the opponent still to play, the game reads %s", game.State)
	}
}

func lineupOf(t *testing.T, s *Service) apitypes.LineupAdvice {
	t.Helper()
	code, env := serve(t, s, leaguePath+"lineup")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("lineup: %d %+v", code, env.Error)
	}
	var out apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
