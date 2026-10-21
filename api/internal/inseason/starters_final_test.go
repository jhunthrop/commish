package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The side's Final (Lane 121 fix round 1, HIGH-1): one predicate on every
// surface, every one of the side's starters with a game final. On the
// Monday-night clock the scoreboard's starters_final agrees, side by side,
// with the Matchup box's own starters' game states (the web's line rule),
// and once every week 6 game is final every side is.
func TestStartersFinalAgreesWithTheMatchupsStartersOnMondayNight(t *testing.T) {
	f, projection := liveFixture(t)
	s := liveService(t, f, projection)
	s.Now = func() time.Time { return mondayNight }
	// Every week 6 game final but one starter's of the member's side, whose club and opponent the
	// other side does not start: the member still plays on Monday night, the opponent is done.
	playing := playingClubs(t, matchupOf(t, s))
	for i := range f.data.Games {
		if g := f.data.Games[i]; g.Week == 6 && !playing[g.Team] {
			f.data.Games[i].Final = true
		}
	}
	s = liveService(t, f, projection)
	s.Now = func() time.Time { return mondayNight }
	box := matchupOf(t, s)
	board := scoreboardOf(t, s)
	sides := map[int]apitypes.ScoreboardSide{}
	for _, g := range board.Games {
		for _, side := range g.Sides {
			sides[side.RosterId] = side
		}
	}
	seen := map[bool]int{}
	for _, b := range box.Sides {
		want := linesFinal(b.Starters)
		got, ok := sides[b.RosterId]
		if !ok || got.StartersFinal == nil {
			t.Fatalf("roster %d: no starters_final on the scoreboard", b.RosterId)
		}
		if *got.StartersFinal != want {
			t.Errorf("roster %d: scoreboard says final %v, its Matchup starters %v", b.RosterId, *got.StartersFinal, want)
		}
		seen[want]++
	}
	if seen[true] == 0 || seen[false] == 0 {
		t.Fatalf("the Monday-night case needs a side done and a side playing: %v", seen)
	}
	for i := range f.data.Games {
		if f.data.Games[i].Week == 6 {
			f.data.Games[i].Final = true
		}
	}
	s = liveService(t, f, projection)
	s.Now = func() time.Time { return mondayNight }
	done := scoreboardOf(t, s)
	for _, g := range done.Games {
		for _, side := range g.Sides {
			// A side with no starter's game held (the fixture's other teams start players with no
			// schedule here) is never final: nothing of it is.
			want := side.Played > 0
			if side.StartersFinal == nil || *side.StartersFinal != want {
				t.Errorf("roster %d: final %v with every week 6 game final, %d played", side.RosterId, side.StartersFinal, side.Played)
			}
		}
	}
}

// A side none of whose starters has a game (all on bye, or slots empty)
// is never Final: nothing of it is final.
func TestStartersFinalIsFalseWithNoGame(t *testing.T) {
	var k kickoffs
	if got := k.startersFinal(); got == nil || *got {
		t.Fatalf("no game: %v", got)
	}
}

// playingClubs is a club and its opponent from the first side's starters
// that the second side does not start, kept unfinished.
func playingClubs(t *testing.T, box apitypes.MatchupBox) map[string]bool {
	t.Helper()
	if len(box.Sides) < 2 {
		t.Fatal("the case needs both sides")
	}
	other := map[string]bool{}
	for _, st := range box.Sides[1].Starters {
		other[st.Line.Player.Team] = true
		if st.Line.Facts.Opponent != nil {
			other[*st.Line.Facts.Opponent] = true
		}
	}
	for _, st := range box.Sides[0].Starters {
		f := st.Line.Facts
		if f.Bye || f.Kickoff == nil || f.Opponent == nil || other[st.Line.Player.Team] || other[*f.Opponent] {
			continue
		}
		return map[string]bool{st.Line.Player.Team: true, *f.Opponent: true}
	}
	t.Fatal("no starter of the first side plays a club the second does not start")
	return nil
}

// linesFinal is the web's rule (kickoff.ts linesRead): every starter with
// a game held has a final game.
func linesFinal(starters []apitypes.BoxStarter) bool {
	games, finals := 0, 0
	for _, st := range starters {
		f := st.Line.Facts
		if f.Bye || f.Kickoff == nil || f.GameState == nil {
			continue
		}
		games++
		if *f.GameState == apitypes.GameStateFinal {
			finals++
		}
	}
	return games > 0 && finals == games
}
