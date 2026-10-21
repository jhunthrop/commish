package inseason

import (
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
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
