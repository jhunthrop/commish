package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// outAhead is the live fixture with the clubs' week 6 games all final but
// those named, which move to Monday night, and the players named out.
func outAhead(t *testing.T, monday []string, out ...string) *Service {
	t.Helper()
	f, projection := liveFixture(t)
	moved := map[string]bool{}
	for _, club := range monday {
		moved[club] = true
	}
	night := time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	for i, g := range f.data.Games {
		if g.Week != 6 {
			continue
		}
		f.data.Games[i].Kickoff, f.data.Games[i].Final = g.Kickoff, true
		if moved[g.Team] {
			f.data.Games[i].Kickoff, f.data.Games[i].Final = night, false
		}
	}
	f.data.Designations = map[string]boards.Designation{}
	for _, id := range out {
		f.data.Designations[id] = boards.Designation{Code: "O", AsOf: liveSunday.Add(-48 * time.Hour)}
	}
	return liveService(t, f, projection)
}

// (i) The member's last starter is out for a game still to come, every
// other starter on both sides final: he can still be swapped, so the card
// is under way with him to play, never Final (fix round 1, HIGH-2), and
// the Lineup has no finished week.
func TestOutStarterAheadKeepsTheMembersCardInPlay(t *testing.T) {
	// h001 plays for CLE (CIN at CLE moved to Monday night).
	s := outAhead(t, []string{"CIN", "CLE"}, "p001")
	game := scoreboardOf(t, s).Games[0]
	if game.State != apitypes.ScoreboardGameStatePlaying {
		t.Fatalf("the card reads %s, want playing", game.State)
	}
	if got := game.Sides[0].ToPlay; got == nil || *got != "1 to play" {
		t.Errorf("the member's side %v, want 1 to play", got)
	}
	if got := game.Sides[1].ToPlay; got != nil {
		t.Errorf("the opponent, all final, says %q", *got)
	}
	if lineup := lineupOf(t, s); lineup.WeekDone != nil {
		t.Errorf("the Lineup says the lineup is done: %q", *lineup.WeekDone)
	}
}

// (ii) The member's starters are all final, the opponent's last two are
// out for a game still to come: the card is under way and Lane 91's
// week_done_state stays Locked until the matchup is final.
func TestOutStarterAheadKeepsTheOpponentsCardInPlay(t *testing.T) {
	// h015 plays for DEN, h024 is the DAL defense (DAL at DEN on Monday).
	s := outAhead(t, []string{"DAL", "DEN"}, "p015", "p024")
	game := scoreboardOf(t, s).Games[0]
	if game.State != apitypes.ScoreboardGameStatePlaying {
		t.Fatalf("the card reads %s, want playing", game.State)
	}
	if game.NextKickoff == nil {
		t.Error("a card under way lost its next kickoff")
	}
	lineup := lineupOf(t, s)
	if lineup.WeekDone == nil || lineup.WeekDoneState == nil || *lineup.WeekDoneState != apitypes.WeekDoneStateLocked {
		t.Errorf("the Lineup's done %v state %v, want the lineup done and Locked", lineup.WeekDone, lineup.WeekDoneState)
	}
}
