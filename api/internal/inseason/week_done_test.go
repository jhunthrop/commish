package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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

// The week is in the books once every starter's game is final (Lane 85):
// one sentence from the API, a bye starter aside, none while any starter's
// game is still to come or under way, none with no starter who has a game.
func TestWeekDoneOnceEveryStartersGameIsFinal(t *testing.T) {
	final, kicked, upcoming := apitypes.GameStateFinal, apitypes.GameStateKickedOff, apitypes.GameStateUpcoming
	cases := []struct {
		name  string
		slots []apitypes.LineupSlot
		want  string
	}{
		{"every game final", []apitypes.LineupSlot{starterAt(final, false), starterAt(final, false)},
			"Every starter's game is final, so week 6 is in the books."},
		{"a bye starter aside", []apitypes.LineupSlot{starterAt(final, false), starterAt("", true)},
			"Every starter's game is final, so week 6 is in the books."},
		{"one kicked off", []apitypes.LineupSlot{starterAt(final, false), starterAt(kicked, false)}, ""},
		{"one still to come", []apitypes.LineupSlot{starterAt(final, false), starterAt(upcoming, false)}, ""},
		{"only byes", []apitypes.LineupSlot{starterAt("", true)}, ""},
		{"no starter", nil, ""},
	}
	for _, c := range cases {
		got := weekDone(c.slots, 6)
		if (got == nil) != (c.want == "") || (got != nil && *got != c.want) {
			t.Errorf("%s: %v, want %q", c.name, got, c.want)
		}
	}
}
