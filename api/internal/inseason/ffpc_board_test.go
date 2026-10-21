package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// ffpcRosterless are the teams whose roster FFPC's rosters page does not
// carry in the board below (Lane 125, B104): two games with none, and one
// game with one side's, so the week-wide rule draws beside the roster
// rule.
var ffpcRosterless = map[int]bool{7: true, 8: true, 9: true, 10: true, 12: true}

// ffpcBoard is the fixture's week as FFPC's read holds the whole
// scoreboard (Lane 125, B104): six games, the member's against team 2,
// and the platform lists no starters for any side but the member's
// (leaguesync ownLineupOnly). Teams 3 to 6 and 11 keep their rosters;
// the ffpcRosterless teams have none. It answers the member's and the
// opponent's roster ids.
func ffpcBoard(f *fixture) (me, them int) {
	me, them = f.league.Snap.Matchups[0].RosterID, f.league.Snap.Matchups[1].RosterID
	mine := f.league.Snap.Matchups[0]
	sides := []leaguesync.Side{mine}
	for roster := 2; roster <= 12; roster++ {
		// The fixture's points, one apart a team, so the bugs' figures differ.
		sides = append(sides, leaguesync.Side{RosterID: roster, Game: (roster + 1) / 2,
			Points: 30 + float64(roster), PlayerPoints: map[string]float64{}})
	}
	sides[1].Points = f.league.Snap.Matchups[1].Points
	f.league.Snap.Matchups = sides
	for i := range f.league.Snap.Teams {
		if team := &f.league.Snap.Teams[i]; ffpcRosterless[team.RosterID] {
			team.Players, team.Reserve, team.Taxi = nil, nil, nil
		}
	}
	return me, them
}

// wantSchedule is a side's schedule_state by the rule, read from the
// fixture rather than the engine: by its roster's clubs where FFPC carries
// the roster, else by the week, kicked off while a club named plays
// (every week 6 game has kicked off at the clocks asked), final after.
func wantSchedule(f fixture, roster int, playing map[string]bool) apitypes.GameState {
	still := len(playing) > 0
	if !ffpcRosterless[roster] {
		team, _ := f.league.Snap.TeamByRoster(roster)
		still = false
		for _, id := range team.Players {
			still = still || playing[f.league.Player(id).Team]
		}
	}
	if still {
		return apitypes.GameStateKickedOff
	}
	return apitypes.GameStateFinal
}

// B104 (Lane 125): on an FFPC scoreboard every other game lists no
// starters on either side, so each reads its state from the schedule:
// each side by its roster's games or the week's, the game final once both
// sides are, playing before. A side with no starters has no projected
// final and no count; its total is FFPC's. The member's game reads as
// Lane 124 left it, and the Lineup and the Matchup with it.
func TestTheFFPCScoreboardReadsEveryOtherGameByTheSchedule(t *testing.T) {
	late := map[string]bool{"DAL": true, "DEN": true}
	for _, tc := range []struct {
		name    string
		at      time.Time
		playing map[string]bool
		member  ffpcRead
	}{
		{"Monday night", mondayNight, late, ffpcRead{game: apitypes.ScoreboardGameStatePlaying,
			board: apitypes.GameStateKickedOff, matchup: apitypes.GameStateKickedOff, mine: true,
			weekDone: apitypes.WeekDoneStateLocked}},
		{"Tuesday, one late final", tuesdayNoon, late, ffpcRead{game: apitypes.ScoreboardGameStatePlaying,
			board: apitypes.GameStateKickedOff, matchup: apitypes.GameStateKickedOff, mine: true,
			weekDone: apitypes.WeekDoneStateLocked}},
		{"Tuesday", tuesdayNoon, nil, ffpcRead{game: apitypes.ScoreboardGameStateFinal,
			board: apitypes.GameStateFinal, matchup: apitypes.GameStateFinal, mine: true,
			weekDone: apitypes.WeekDoneStateFinal}},
		{"Wednesday", wednesdayEvening, nil, ffpcRead{game: apitypes.ScoreboardGameStateFinal,
			board: apitypes.GameStateFinal, matchup: apitypes.GameStateFinal, mine: true,
			weekDone: apitypes.WeekDoneStateFinal}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, projection := liveFixture(t)
			me, them := ffpcBoard(&f)
			finishWeekBut(&f, tc.playing)
			s := ffpcService(t, f, projection, tc.at)
			if got := readFFPC(t, s, me, them); got != tc.member {
				t.Errorf("the member's game: %+v, want %+v", got, tc.member)
			}
			board := scoreboardOf(t, s)
			if len(board.Games) != 6 {
				t.Fatalf("%d games, want 6", len(board.Games))
			}
			forms := map[apitypes.GameState]bool{}
			for _, g := range board.Games[1:] {
				states := otherGameSides(t, f, g, tc.playing)
				for _, st := range states {
					forms[st] = true
				}
				want := apitypes.ScoreboardGameStateFinal
				if states[0] != apitypes.GameStateFinal || states[1] != apitypes.GameStateFinal {
					want = apitypes.ScoreboardGameStatePlaying
				}
				if g.State != want || g.NextKickoff != nil || g.ToPlay != nil {
					t.Errorf("game %d v %d: %s next %v count %v, want %s", g.Sides[0].RosterId, g.Sides[1].RosterId,
						g.State, g.NextKickoff, g.ToPlay, want)
				}
			}
			// Monday night and the late Tuesday draw both forms of a side, Tuesday on only Final.
			if tc.playing != nil && (!forms[apitypes.GameStateFinal] || !forms[apitypes.GameStateKickedOff]) {
				t.Errorf("the other games' sides draw only %v", forms)
			}
		})
	}
}

// otherGameSides checks one game of the board the member is not in: both
// sides unlisted, their schedule_state by the rule, no projected final,
// no count, no starters_final, FFPC's total; it answers their states.
func otherGameSides(t *testing.T, f fixture, g apitypes.ScoreboardGame, playing map[string]bool) [2]apitypes.GameState {
	t.Helper()
	var states [2]apitypes.GameState
	if len(g.Sides) != 2 {
		t.Fatalf("a game of %d sides", len(g.Sides))
	}
	for i, side := range g.Sides {
		want := wantSchedule(f, side.RosterId, playing)
		if side.ScheduleState == nil || *side.ScheduleState != want {
			t.Errorf("team %d schedule_state %v, want %s", side.RosterId, side.ScheduleState, want)
		} else {
			states[i] = *side.ScheduleState
		}
		if side.Starters != 0 || side.Played != 0 || side.StartersFinal != nil || side.ProjectedFinal != nil ||
			side.Projection != nil || side.ToPlay != nil || (side.InPlay != nil && *side.InPlay != 0) {
			t.Errorf("team %d with no starters: %+v", side.RosterId, side)
		}
		if side.Points != 30+float64(side.RosterId) || !side.PointsRead {
			t.Errorf("team %d points %v read %v, want FFPC's total", side.RosterId, side.Points, side.PointsRead)
		}
	}
	return states
}

// The member's FFPC opponent, listing no starters, has no projected final
// on the board or the Matchup (Lane 125): with no starter to project, his
// points so far would read as his final while his roster still plays.
func TestAnFFPCOpponentWithNoStartersHasNoProjectedFinal(t *testing.T) {
	f, projection := liveFixture(t)
	me, them := ffpcBoard(&f)
	finishWeekBut(&f, map[string]bool{"DAL": true, "DEN": true})
	s := ffpcService(t, f, projection, mondayNight)
	_, theirs := sideOf(t, scoreboardOf(t, s), them)
	box := matchupOf(t, s)
	if theirs.ProjectedFinal != nil || boxSideOf(t, box, them).ProjectedFinal != nil {
		t.Errorf("the opponent's projected final: board %v, Matchup %v", theirs.ProjectedFinal, boxSideOf(t, box, them).ProjectedFinal)
	}
	if _, mine := sideOf(t, scoreboardOf(t, s), me); mine.ProjectedFinal == nil {
		t.Error("the member's side, listing starters, lost its projected final")
	}
}
