package inseason

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// starterAt is a lineup spot whose starter's game is in the state given,
// or on bye.
func starterAt(state apitypes.GameState, bye bool) apitypes.LineupSlot {
	kickoff := time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	facts := apitypes.WeekFacts{Week: 6, Bye: bye}
	if !bye {
		s := state
		facts.Kickoff, facts.GameState = &kickoff, &s
	}
	return apitypes.LineupSlot{Ours: apitypes.PlayerLine{Facts: facts}}
}

// Every starter of the member's has played once every one's game is
// final (Lane 85): one sentence from the API, a bye starter aside, none
// while any starter's game is still to come or under way, none with no
// starter who has a game. It says the lineup, never the week (Lane 91).
func TestWeekDoneOnceEveryStartersGameIsFinal(t *testing.T) {
	final, kicked, upcoming := apitypes.GameStateFinal, apitypes.GameStateKickedOff, apitypes.GameStateUpcoming
	const said = "Every starter of yours has played, so nothing is left to set."
	cases := []struct {
		name  string
		slots []apitypes.LineupSlot
		want  string
	}{
		{"every game final", []apitypes.LineupSlot{starterAt(final, false), starterAt(final, false)}, said},
		{"a bye starter aside", []apitypes.LineupSlot{starterAt(final, false), starterAt("", true)}, said},
		{"one kicked off", []apitypes.LineupSlot{starterAt(final, false), starterAt(kicked, false)}, ""},
		{"one still to come", []apitypes.LineupSlot{starterAt(final, false), starterAt(upcoming, false)}, ""},
		{"only byes", []apitypes.LineupSlot{starterAt("", true)}, ""},
		{"no starter", nil, ""},
	}
	for _, c := range cases {
		got := weekDone(c.slots)
		if (got == nil) != (c.want == "") || (got != nil && *got != c.want) {
			t.Errorf("%s: %v, want %q", c.name, got, c.want)
		}
	}
	if WeekDoneWords() != said {
		t.Errorf("the words %q", WeekDoneWords())
	}
}

// weekStates sets the fixture's week 6 games at fixtureNow: a game is
// final when either club is in final, kicked off when either is in
// kicked, still to come otherwise.
func weekStates(f *fixture, final, kicked map[string]bool) {
	for i := range f.data.Games {
		g := &f.data.Games[i]
		if g.Week != 6 {
			continue
		}
		switch {
		case final[g.Team] || final[g.Opponent]:
			g.Kickoff, g.Final = fixtureNow.Add(-4*time.Hour), true
		case kicked[g.Team] || kicked[g.Opponent]:
			g.Kickoff, g.Final = fixtureNow.Add(-time.Hour), false
		default:
			g.Kickoff, g.Final = fixtureNow.Add(48*time.Hour), false
		}
	}
}

// everyClubBut is every fixture club final, the games of the clubs given
// aside.
func everyClubBut(f fixture, clubs ...string) map[string]bool {
	vs := opponentOf(f)
	out := map[string]bool{}
	for _, c := range fixtureTeams() {
		out[c] = true
	}
	for _, c := range clubs {
		delete(out, c)
		delete(out, vs[c])
	}
	return out
}

// clubsOf is the clubs of the hosts' players given.
func clubsOf(f fixture, hosts []string) map[string]bool {
	out := map[string]bool{}
	for _, h := range hosts {
		out[f.league.Player(h).Team] = true
	}
	return out
}

// opponentOf is each week 6 club's opponent.
func opponentOf(f fixture) map[string]string {
	out := map[string]string{}
	for _, g := range f.data.Games {
		if g.Week == 6 {
			out[g.Team] = g.Opponent
		}
	}
	return out
}

// opponentOnly is team 2's starters' clubs whose game no club of team
// 1's roster plays in, in the starters' order, each game once.
func opponentOnly(f fixture) []string {
	one, _ := f.league.Snap.TeamByRoster(1)
	two, _ := f.league.Snap.TeamByRoster(2)
	mine, vs := clubsOf(f, one.Players), opponentOf(f)
	var out []string
	seen := map[string]bool{}
	for _, h := range two.Starters {
		club := f.league.Player(h).Team
		other, plays := vs[club]
		if !plays || mine[club] || mine[other] || seen[club] || seen[other] {
			continue
		}
		seen[club] = true
		out = append(out, club)
	}
	return out
}

func lineupAnswer(t *testing.T, f fixture) apitypes.LineupAdvice {
	t.Helper()
	code, env := serve(t, fixtureService(t, f.league, f.data, &fakeHolds{}), leaguePath+"lineup")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("lineup: %d %+v", code, env.Error)
	}
	var out apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// A locked lineup is not a finished week (Lane 91): with every starter of
// the member's final, the state is locked while any starter on the
// opponent's side still has a game to play and final once both sides'
// are, by the scoreboard's own count; a member with no opponent is final
// on their own starters. A starter of theirs still to come: no sentence,
// no state.
func TestWeekDoneStateIsTheMatchups(t *testing.T) {
	cases := []struct {
		name string
		set  func(f *fixture)
		want apitypes.WeekDoneState
	}{
		{"the opponent has one kicked off, one to come", func(f *fixture) {
			theirs := opponentOnly(*f)
			if len(theirs) < 2 {
				t.Fatalf("the fixture's opponent has %v apart", theirs)
			}
			// Every game final but the opponent's two apart: one under way, one to come.
			weekStates(f, everyClubBut(*f, theirs[0], theirs[1]), map[string]bool{theirs[0]: true})
		}, apitypes.WeekDoneStateLocked},
		{"every starter on both sides final", func(f *fixture) {
			weekStates(f, everyClubBut(*f), nil)
		}, apitypes.WeekDoneStateFinal},
		{"no opponent this week", func(f *fixture) {
			one, _ := f.league.Snap.TeamByRoster(1)
			weekStates(f, clubsOf(*f, one.Players), nil)
			f.league.Snap.Matchups = []leaguesync.Side{{RosterID: 1, Game: 0, Starters: one.Starters}}
		}, apitypes.WeekDoneStateFinal},
	}
	for _, c := range cases {
		f := pairedFixture(t)
		c.set(&f)
		got := lineupAnswer(t, f)
		if got.WeekDone == nil || *got.WeekDone != WeekDoneWords() {
			t.Fatalf("%s: week done %v", c.name, got.WeekDone)
		}
		if got.WeekDoneState == nil {
			t.Errorf("%s: no state, want %s", c.name, c.want)
		} else if *got.WeekDoneState != c.want {
			t.Errorf("%s: state %s, want %s", c.name, *got.WeekDoneState, c.want)
		}
	}
	// One starter of the member's still to come: no sentence and no state.
	f := pairedFixture(t)
	one, _ := f.league.Snap.TeamByRoster(1)
	weekStates(&f, everyClubBut(f, f.league.Player(one.Starters[0]).Team), nil)
	if got := lineupAnswer(t, f); got.WeekDone != nil || got.WeekDoneState != nil {
		t.Errorf("a starter still to come: %v %v", got.WeekDone, got.WeekDoneState)
	}
}
