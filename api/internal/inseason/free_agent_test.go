package inseason

import (
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/figurewords"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// A free agent has no club (Lane 123, B101): the daily list clears his
// club to NULL and the board reads it as "" (boards.TestAFreeAgentReadsNoClub).
// Through the engine's public player read, his card head's club cell is
// "FA", and his week holds no game: no bye, no opponent, no kickoff, no
// opponent rank and no week projection, even with a snapshot naming him.
func TestTheCardHeadOfAFreeAgentReadsFAWithNoGame(t *testing.T) {
	f := newFixture(t)
	before := f.raw.Players[0]
	projection := boards.WeekProjection{Week: 6, Players: map[string]boards.ProjectedPoints{before.ID: {PPR: 14.2, Half: 12.1, Standard: 10}},
		Defenses: map[string]boards.ProjectedPoints{}, Kickers: map[string]boards.ProjectedPoints{}}
	read := func(club string) apitypes.PlayerWeek {
		raw := *f.raw
		raw.Players = slices.Clone(f.raw.Players)
		raw.Players[0].Team = club
		if club == "" {
			raw.Players[0].Bye = 0
		}
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
		s.Facts = fakeFacts{data: f.data, projection: projection}
		s.Boards = fakeBoards{board: board}
		return playerWeekOf(t, s, "/players/"+before.ID+"/week")
	}
	// The control: on his club, the snapshot's figure is his week's projection.
	if on := read(before.Team); on.Line.WeekProjection == nil || on.Line.Facts.Opponent == nil {
		t.Fatalf("on %s: %+v, want his club's game and the snapshot's projection", before.Team, on.Line)
	}
	line := read("").Line
	if line.Player.Team != figurewords.Table.FreeAgentClub || line.Player.Team != "FA" {
		t.Fatalf("club cell %q, want FA", line.Player.Team)
	}
	facts := line.Facts
	if facts.Bye || facts.Opponent != nil || facts.Kickoff != nil || facts.Home != nil {
		t.Fatalf("facts %+v, want no game and no bye", facts)
	}
	if line.OppRank != nil || line.WeekProjection != nil || line.ProjectionDelta != nil {
		t.Fatalf("opp rank %v, projection %v, delta %v: want none without a game", line.OppRank, line.WeekProjection, line.ProjectionDelta)
	}
}

// The answer's club is a string either way: a club's code for a player
// on one, "FA" for the store's NULL.
func TestWireClubNamesAFreeAgentFA(t *testing.T) {
	if got := boards.WireClub(""); got != "FA" {
		t.Fatalf("WireClub(\"\") = %q", got)
	}
	if got := boards.WireClub("BUF"); got != "BUF" {
		t.Fatalf("WireClub(BUF) = %q", got)
	}
}

// A free agent's week figure is zero (Lane 127, B103): his club is "" on
// the board, so a run row still carrying the model's one more game
// (game_points, written before the nightly zeroed it) or rest-of-season
// points counts for nothing in the live order, a league whose title week
// is past the run's included; the Miami back on the same board keeps his
// run's points and his week 18 game.
func TestAFreeAgentsWeekFigureIsZero(t *testing.T) {
	mia, free, game18 := 120.0, 30.0, 9.0
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: 6, AsOf: restRunInstant,
		Players: []boards.Player{
			{ID: "mia", Name: "A Dolphin", Position: draft.RB, Team: "MIA", Points: &mia, GamePoints: &game18},
			{ID: "fa", Name: "A Free Agent", Position: draft.RB, Team: "", Points: &free, GamePoints: &game18},
			// A run older than game_points (revision 0015) carries his points alone.
			{ID: "old", Name: "An Older Free Agent", Position: draft.RB, Team: "", Points: &free},
		}}
	b, err := boards.For(raw, 12, twelveTeamPPR(t))
	if err != nil {
		t.Fatal(err)
	}
	games := append(restWeekSix(false, false), game(18, "MIA", "NE", restSunday.AddDate(0, 0, 7*12), false)...)
	rest := RestAt(games, 6, restRunInstant, restRunInstant, Horizon{Last: MaxWeek})
	live, err := LiveBoard(b, rest)
	if err != nil {
		t.Fatal(err)
	}
	dolphin, _ := live.Player("mia")
	for _, id := range []string{"fa", "old"} {
		if fa, _ := live.Player(id); fa.Points == nil || *fa.Points != 0 {
			t.Fatalf("free agent %s live points %v, want 0", id, fa.Points)
		}
	}
	if dolphin.Points == nil || *dolphin.Points != mia+game18 {
		t.Fatalf("Miami back live points %v, want %v", dolphin.Points, mia+game18)
	}
}
