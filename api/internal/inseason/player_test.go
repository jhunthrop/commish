package inseason

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// fakeBoards answers the public read's board: the fixture league's.
type fakeBoards struct{ board boards.Board }

func (f fakeBoards) For(context.Context, apitypes.LeagueSettings) (boards.Board, error) {
	return f.board, nil
}

func playerWeekOf(t *testing.T, s *Service, path string) apitypes.PlayerWeek {
	t.Helper()
	code, env := serve(t, s, path)
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%s: %d %+v", path, code, env.Error)
	}
	var out apitypes.PlayerWeek
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// With no league the page reads his week in PPR, placed on our board: the club's game, the
// week's projection, and no verb.
func TestThePublicPlayerWeekReadsPPRWithNoVerb(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season = 2026
	bp := f.raw.Players[0]
	s.Facts = fakeFacts{data: f.data, projection: boards.WeekProjection{}}
	s.Boards = fakeBoards{board: f.league.Board}
	out := playerWeekOf(t, s, "/players/"+bp.ID+"/week")
	if out.Week != 6 || out.Verb != nil || out.ProjectionScoring.Format != apitypes.ProjectionScoringFormatPpr || out.ProjectionScoring.LeagueOwn {
		t.Fatalf("week %d verb %+v scoring %+v", out.Week, out.Verb, out.ProjectionScoring)
	}
	if out.Line.Facts.Opponent == nil || out.Line.Player.BoardId == nil || *out.Line.Player.BoardId != bp.ID {
		t.Fatalf("line %+v", out.Line)
	}
	if out.Line.Player.Name != bp.Name || out.Line.Player.Team != bp.Team || out.Line.PositionRank == nil {
		t.Fatalf("his club, position and rank come from our board: %+v", out.Line)
	}
	if out.Line.WeekProjection != nil || out.ProjectionReadAt != nil {
		t.Fatalf("no snapshot stored, no figure: %+v %v", out.Line.WeekProjection, out.ProjectionReadAt)
	}
}

// A kicker, a defense or a player our board does not place has no page,
// so the read answers 404 whatever the caller sends.
func TestThePublicPlayerWeekHasNoKickerOrDefense(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season = 2026
	s.Boards = fakeBoards{board: f.league.Board}
	for _, path := range []string{"/players/p008/week", "/players/p009/week?position=WR", "/players/nobody/week"} {
		if code, env := serve(t, s, path); code != http.StatusNotFound || env.Error == nil {
			t.Fatalf("%s: %d", path, code)
		}
	}
}

// The verb is what the league's screens would give him: the lineup for
// one of the drafter's own, start where our lineup starts him and the
// platform's does not, a trade where another roster holds him, the
// platform's waiver page where none does.
func TestTheLeaguePlayerWeekGivesTheScreensVerb(t *testing.T) {
	f := newFixture(t)
	advice, ok := newFixtureAdvisor(t, f, nil).Lineup()
	if !ok || len(advice.Slots) == 0 {
		t.Fatal("no lineup")
	}
	started := advice.Slots[0].Ours.Player
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	if got := playerWeekOf(t, s, leaguePath+"players/"+*started.BoardId); got.Verb == nil || got.Verb.Kind != apitypes.PlayerVerbKindLineup {
		t.Fatalf("a starter set on the platform: %+v", got.Verb)
	}
	// The platform benches him: the verb starts him.
	team := &f.league.Snap.Teams[0]
	team.Starters = slices.DeleteFunc(slices.Clone(team.Starters), func(id string) bool { return id == started.HostId })
	s = fixtureService(t, f.league, f.data, &fakeHolds{})
	if got := playerWeekOf(t, s, leaguePath+"players/"+*started.BoardId); got.Verb == nil || got.Verb.Kind != apitypes.PlayerVerbKindStart {
		t.Fatalf("a starter the platform benches: %+v", got.Verb)
	}
	theirs := playerWeekOf(t, s, leaguePath+"players/p015")
	if theirs.Verb == nil || theirs.Verb.Kind != apitypes.PlayerVerbKindTrade || theirs.Verb.Holder == nil || *theirs.Verb.Holder != "Team 2" {
		t.Fatalf("another roster's: %+v", theirs.Verb)
	}
	free := playerWeekOf(t, s, leaguePath+"players/p190")
	if free.Verb == nil || free.Verb.Kind != apitypes.PlayerVerbKindWaivers || free.Verb.HostUrl == nil ||
		*free.Verb.HostUrl != "https://sleeper.com/leagues/1382163311038038016/players" {
		t.Fatalf("a free player: %+v", free.Verb)
	}
	if free.Week != 6 || free.Line.Player.Name != "Player 190" {
		t.Fatalf("a free player's line: %d %+v", free.Week, free.Line.Player)
	}
	// Sleeper takes no claim from here, whatever the moves say.
	s.Moves = &fakeMoves{}
	if got := playerWeekOf(t, s, leaguePath+"players/p190"); got.Verb.Kind != apitypes.PlayerVerbKindWaivers {
		t.Fatalf("a free player on Sleeper with claims on: %+v", got.Verb)
	}
}

// On ESPN with claims on, a free player's verb is the claim.
func TestClaimVerbFollowsTheMoves(t *testing.T) {
	f := newFixture(t)
	f.league.Snap.Ref.Host = "espn"
	a := newFixtureAdvisor(t, f, nil)
	bp := boards.Player{ID: "4426515", Name: "Puka Nacua", Position: "WR", Team: "LAR"}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	if got := s.claimVerb(req, a, bp, apitypes.PlayerVerb{}); got.Kind != apitypes.PlayerVerbKindWaivers {
		t.Fatalf("no moves wired: %+v", got)
	}
	s.Moves = &fakeMoves{}
	if got := s.claimVerb(req, a, bp, apitypes.PlayerVerb{}); got.Kind != apitypes.PlayerVerbKindClaim {
		t.Fatalf("claims on: %+v", got)
	}
}

func TestTheLeaguePlayerWeekHasNoKickerOrDefense(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	for _, id := range []string{"p008", "p009", "nobody"} {
		if code, _ := serve(t, s, leaguePath+"players/"+id); code != http.StatusNotFound {
			t.Fatalf("%s: %d", id, code)
		}
	}
}

// A kicker or defense has no page, so its row links nowhere.
func TestAKickerOrDefenseRowLinksNowhere(t *testing.T) {
	f := newFixture(t)
	out, ok := newFixtureAdvisor(t, f, nil).Lineup()
	if !ok {
		t.Fatal("no team")
	}
	kickers := 0
	for _, s := range out.Slots {
		if p := s.Ours.Player.Position; p == "K" || p == "DEF" {
			kickers++
			if s.Ours.Slug != nil {
				t.Fatalf("%s %s links to %s", p, s.Ours.Player.Name, *s.Ours.Slug)
			}
		}
	}
	if kickers == 0 {
		t.Fatal("the fixture starts no kicker or defense")
	}
}
