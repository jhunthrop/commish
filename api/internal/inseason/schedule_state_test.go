package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// ffpcPairing is the fixture's member game as FFPC's read holds it (Lane
// 121 fix round 2): the platform lists the opponent no starters. With
// roster false the read carries no roster for the opponent either, so
// only the week's schedule can say its state. It answers the member's and
// the opponent's roster ids.
func ffpcPairing(t *testing.T, f *fixture, roster bool) (me, them int) {
	t.Helper()
	mine := f.league.Snap.Matchups[0]
	them = -1
	for i := range f.league.Snap.Matchups {
		side := &f.league.Snap.Matchups[i]
		if side.Game == mine.Game && side.RosterID != mine.RosterID {
			side.Starters, side.PlayerPoints = nil, nil
			them = side.RosterID
		}
	}
	if them < 0 {
		t.Fatal("the member's game has no opponent")
	}
	if !roster {
		for i := range f.league.Snap.Teams {
			if team := &f.league.Snap.Teams[i]; team.RosterID == them {
				team.Players, team.Reserve, team.Taxi = nil, nil, nil
			}
		}
	}
	return mine.RosterID, them
}

// finishWeekBut turns every week 6 game final but the clubs named, whose
// game is still on.
func finishWeekBut(f *fixture, playing map[string]bool) {
	for i := range f.data.Games {
		if f.data.Games[i].Week == 6 {
			f.data.Games[i].Final = !playing[f.data.Games[i].Team]
		}
	}
}

// rosterClubStillPlaying is a club on the opponent's roster (the
// Matchup's bench for a side listing no starters) and its opponent that
// no starter of the member's plays in, kept unfinished.
func rosterClubStillPlaying(t *testing.T, box apitypes.MatchupBox, me int) map[string]bool {
	t.Helper()
	mine := map[string]bool{}
	var bench []apitypes.PlayerLine
	for _, side := range box.Sides {
		if side.RosterId != me {
			bench = side.Bench
			continue
		}
		for _, st := range side.Starters {
			mine[st.Line.Player.Team] = true
			if st.Line.Facts.Opponent != nil {
				mine[*st.Line.Facts.Opponent] = true
			}
		}
	}
	for _, l := range bench {
		f := l.Facts
		if f.Bye || f.Kickoff == nil || f.Opponent == nil || mine[l.Player.Team] || mine[*f.Opponent] {
			continue
		}
		return map[string]bool{l.Player.Team: true, *f.Opponent: true}
	}
	t.Fatal("no club on the opponent's roster plays a game the member's starters do not")
	return nil
}

// sideOf is a roster's side of the member's scoreboard game, and the game.
func sideOf(t *testing.T, board apitypes.Scoreboard, roster int) (apitypes.ScoreboardGame, apitypes.ScoreboardSide) {
	t.Helper()
	for _, g := range board.Games {
		for _, s := range g.Sides {
			if s.RosterId == roster {
				return g, s
			}
		}
	}
	t.Fatalf("no scoreboard side for roster %d", roster)
	return apitypes.ScoreboardGame{}, apitypes.ScoreboardSide{}
}

// boxSideOf is a roster's side of the Matchup box.
func boxSideOf(t *testing.T, box apitypes.MatchupBox, roster int) apitypes.MatchupBoxSide {
	t.Helper()
	for _, s := range box.Sides {
		if s.RosterId == roster {
			return s
		}
	}
	t.Fatalf("no Matchup side for roster %d", roster)
	return apitypes.MatchupBoxSide{}
}

// The FFPC opponent's state on a screen at a clock: the scoreboard
// game's, the opponent's schedule_state there and on the Matchup, the
// member's starters_final and the Lineup's week_done_state.
type ffpcRead struct {
	game     apitypes.ScoreboardGameState
	board    apitypes.GameState
	matchup  apitypes.GameState
	mine     bool
	weekDone apitypes.WeekDoneState
}

func readFFPC(t *testing.T, s *Service, me, them int) ffpcRead {
	t.Helper()
	board := scoreboardOf(t, s)
	game, theirs := sideOf(t, board, them)
	_, mine := sideOf(t, board, me)
	box := boxSideOf(t, matchupOf(t, s), them)
	lineup := lineupOf(t, s)
	if theirs.ScheduleState == nil || box.ScheduleState == nil {
		t.Fatalf("the opponent listing no starters sends no schedule_state: board %v, Matchup %v", theirs.ScheduleState, box.ScheduleState)
	}
	if mine.ScheduleState != nil {
		t.Errorf("the member's side lists starters and sends schedule_state %s", *mine.ScheduleState)
	}
	if theirs.StartersFinal != nil {
		t.Errorf("the opponent listing no starters sends starters_final %v", *theirs.StartersFinal)
	}
	if mine.StartersFinal == nil || lineup.WeekDoneState == nil {
		t.Fatalf("the member's starters_final %v, week_done_state %v", mine.StartersFinal, lineup.WeekDoneState)
	}
	return ffpcRead{game: game.State, board: *theirs.ScheduleState, matchup: *box.ScheduleState,
		mine: *mine.StartersFinal, weekDone: *lineup.WeekDoneState}
}

func ffpcService(t *testing.T, f fixture, projection boards.WeekProjection, at time.Time) *Service {
	t.Helper()
	s := liveService(t, f, projection)
	s.Now = func() time.Time { return at }
	return s
}

// B102 (Lane 124): an FFPC opponent with no box keeps his game state. On
// Monday night the member's side is done while a club on the opponent's
// roster still plays: the opponent's state comes from his roster's games
// (kicked off), so the game is never final (the head reads Kicked off, the
// Lineup Locked), while the member's side reads Final by its own rule. On
// Tuesday, every game final, both are.
func TestAnFFPCOpponentWithNoBoxReadsByHisRoster(t *testing.T) {
	f, projection := liveFixture(t)
	me, them := ffpcPairing(t, &f, true)
	playing := rosterClubStillPlaying(t, matchupOf(t, ffpcService(t, f, projection, mondayNight)), me)
	finishWeekBut(&f, playing)
	got := readFFPC(t, ffpcService(t, f, projection, mondayNight), me, them)
	want := ffpcRead{game: apitypes.ScoreboardGameStatePlaying, board: apitypes.GameStateKickedOff,
		matchup: apitypes.GameStateKickedOff, mine: true, weekDone: apitypes.WeekDoneStateLocked}
	if got != want {
		t.Errorf("Monday night, %v still playing: %+v, want %+v", playing, got, want)
	}
	finishWeekBut(&f, nil)
	got = readFFPC(t, ffpcService(t, f, projection, tuesdayNoon), me, them)
	want = ffpcRead{game: apitypes.ScoreboardGameStateFinal, board: apitypes.GameStateFinal,
		matchup: apitypes.GameStateFinal, mine: true, weekDone: apitypes.WeekDoneStateFinal}
	if got != want {
		t.Errorf("Tuesday: %+v, want %+v", got, want)
	}
}

// Where the read carries no roster for the opponent, his state is the
// league-wide rule: every game of the week final. One game still on on
// Monday night, none of the member's starters in it, keeps the game from
// Final; on Tuesday it is final.
func TestAnFFPCOpponentWithNoRosterReadsByTheWeek(t *testing.T) {
	f, projection := liveFixture(t)
	me, them := ffpcPairing(t, &f, false)
	box := matchupOf(t, ffpcService(t, f, projection, mondayNight))
	if side := boxSideOf(t, box, them); len(side.Bench) != 0 || len(side.Starters) != 0 {
		t.Fatalf("the opponent with no roster read: %d starters, %d bench", len(side.Starters), len(side.Bench))
	}
	playing := clubsTheMemberDoesNotStart(t, box, f, me)
	finishWeekBut(&f, playing)
	got := readFFPC(t, ffpcService(t, f, projection, mondayNight), me, them)
	want := ffpcRead{game: apitypes.ScoreboardGameStatePlaying, board: apitypes.GameStateKickedOff,
		matchup: apitypes.GameStateKickedOff, mine: true, weekDone: apitypes.WeekDoneStateLocked}
	if got != want {
		t.Errorf("Monday night, %v still playing: %+v, want %+v", playing, got, want)
	}
	finishWeekBut(&f, nil)
	got = readFFPC(t, ffpcService(t, f, projection, tuesdayNoon), me, them)
	want = ffpcRead{game: apitypes.ScoreboardGameStateFinal, board: apitypes.GameStateFinal,
		matchup: apitypes.GameStateFinal, mine: true, weekDone: apitypes.WeekDoneStateFinal}
	if got != want {
		t.Errorf("Tuesday: %+v, want %+v", got, want)
	}
}

// clubsTheMemberDoesNotStart is a week 6 game, both clubs, that no starter
// of the member's plays in.
func clubsTheMemberDoesNotStart(t *testing.T, box apitypes.MatchupBox, f fixture, me int) map[string]bool {
	t.Helper()
	mine := map[string]bool{}
	for _, st := range boxSideOf(t, box, me).Starters {
		mine[st.Line.Player.Team] = true
		if st.Line.Facts.Opponent != nil {
			mine[*st.Line.Facts.Opponent] = true
		}
	}
	for _, g := range f.data.Games {
		if g.Week == 6 && !mine[g.Team] && !mine[g.Opponent] {
			return map[string]bool{g.Team: true, g.Opponent: true}
		}
	}
	t.Fatal("every week 6 game has a starter of the member's")
	return nil
}

// A game whose sides list no starters at all reads by the schedule alone:
// upcoming before any game it reads, final once every one is.
func TestGameStateOfUnlistedSidesIsTheSchedules(t *testing.T) {
	at := time.Date(2026, 10, 18, 13, 0, 0, 0, east)
	upcoming, final := apitypes.GameStateUpcoming, apitypes.GameStateFinal
	var before, after kickoffs
	before.add(apitypes.WeekFacts{Kickoff: &at, GameState: &upcoming})
	after.add(apitypes.WeekFacts{Kickoff: &at, GameState: &final})
	if state, next := gameState(kickoffs{}, []*kickoffs{&before, nil}); state != apitypes.ScoreboardGameStateUpcoming || next == nil || !next.Equal(at) {
		t.Errorf("before: %s next %v", state, next)
	}
	if state, _ := gameState(kickoffs{}, []*kickoffs{&after, &before}); state != apitypes.ScoreboardGameStatePlaying {
		t.Errorf("one side final, one to come: %s", state)
	}
	if state, _ := gameState(kickoffs{}, []*kickoffs{&after, &after}); state != apitypes.ScoreboardGameStateFinal {
		t.Errorf("after: %s", state)
	}
	if got := scheduleStateOf(nil); got != nil {
		t.Errorf("a listed side's schedule_state: %v", *got)
	}
}
