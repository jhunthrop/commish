package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// A score bug under way counts only starters with a game this week (Lane
// 85 fix round, M3): a bye starter is neither to play nor played and
// leaves the count.
func TestToPlayCountsOnlyStartersWithAGame(t *testing.T) {
	kickoff := time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	at := func(state apitypes.GameState) apitypes.WeekFacts {
		s, k := state, kickoff
		return apitypes.WeekFacts{GameState: &s, Kickoff: &k}
	}
	var game kickoffs
	for _, f := range []apitypes.WeekFacts{at(apitypes.GameStateFinal), at(apitypes.GameStateKickedOff),
		at(apitypes.GameStateUpcoming), {Bye: true}, {}} {
		game.add(f)
	}
	if got := game.toPlay(); got == nil || *got != "1 of 3 starters to play" {
		t.Fatalf("to play %v", got)
	}
	var before kickoffs
	before.add(at(apitypes.GameStateUpcoming))
	before.add(apitypes.WeekFacts{Bye: true})
	if got := before.toPlay(); got != nil {
		t.Errorf("before kickoff %q", *got)
	}
	var over kickoffs
	over.add(at(apitypes.GameStateFinal))
	over.add(apitypes.WeekFacts{Bye: true})
	if got := over.toPlay(); got != nil {
		t.Errorf("once final %q", *got)
	}
}
