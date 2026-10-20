package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

var toPlayKickoff = time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)

// startedAt is a starter's facts in a game of that state, with a
// designation when status is set.
func startedAt(state apitypes.GameState, status apitypes.DesignationStatus) apitypes.WeekFacts {
	s, k := state, toPlayKickoff
	f := apitypes.WeekFacts{GameState: &s, Kickoff: &k}
	if status != "" {
		f.Designation = &apitypes.InjuryDesignation{Status: status, AsOf: toPlayKickoff}
	}
	return f
}

// countOf is the kickoffs of these starters.
func countOf(facts ...apitypes.WeekFacts) kickoffs {
	var k kickoffs
	for _, f := range facts {
		k.add(f)
	}
	return k
}

// A score bug under way never prints a zero (Lane 92, B02): the starters
// still to come while any is, else those in play; a bye starter, or one
// with no game held, leaves the count.
func TestToPlayNeverPrintsAZero(t *testing.T) {
	final, live, ahead := apitypes.GameStateFinal, apitypes.GameStateKickedOff, apitypes.GameStateUpcoming
	cases := []struct {
		name  string
		facts []apitypes.WeekFacts
		state apitypes.ScoreboardGameState
		want  string
	}{
		{"one still to come", []apitypes.WeekFacts{startedAt(final, ""), startedAt(live, ""), startedAt(ahead, ""), {Bye: true}, {}},
			apitypes.ScoreboardGameStatePlaying, "1 to play"},
		{"none to come, two in play", []apitypes.WeekFacts{startedAt(final, ""), startedAt(live, ""), startedAt(live, "")},
			apitypes.ScoreboardGameStatePlaying, "2 playing"},
		{"every starter final", []apitypes.WeekFacts{startedAt(final, ""), {Bye: true}},
			apitypes.ScoreboardGameStateFinal, ""},
		{"before kickoff", []apitypes.WeekFacts{startedAt(ahead, ""), {Bye: true}},
			apitypes.ScoreboardGameStateUpcoming, ""},
	}
	for _, c := range cases {
		k := countOf(c.facts...)
		if got := k.state(); got != c.state {
			t.Errorf("%s: state %s, want %s", c.name, got, c.state)
		}
		got := k.toPlay(k.state())
		switch {
		case c.want == "" && got != nil:
			t.Errorf("%s: %q, want none", c.name, *got)
		case c.want != "" && (got == nil || *got != c.want):
			t.Errorf("%s: %v, want %q", c.name, got, c.want)
		}
	}
}

// A side whose every starter is final, on bye or out of a game under way
// reads final (Lane 92, B02, the FFPC card); a questionable one still
// plays. An out starter whose game is still to come is still to play
// (fix round 1, HIGH-2): he can be swapped, and the platform keeps the
// matchup in progress.
func TestToPlayOutStarterIsDone(t *testing.T) {
	final, live, ahead := apitypes.GameStateFinal, apitypes.GameStateKickedOff, apitypes.GameStateUpcoming
	waiting := countOf(startedAt(final, ""), startedAt(ahead, apitypes.DesignationStatusOut))
	if got := waiting.state(); got != apitypes.ScoreboardGameStatePlaying {
		t.Errorf("an out starter still to come reads %s, want playing", got)
	}
	if got := waiting.toPlay(waiting.state()); got == nil || *got != "1 to play" {
		t.Errorf("an out starter still to come counts %v, want 1 to play", got)
	}
	done := countOf(startedAt(final, ""), startedAt(live, apitypes.DesignationStatusOut),
		startedAt(live, apitypes.DesignationStatusInjuredReserve), apitypes.WeekFacts{Bye: true})
	if got := done.state(); got != apitypes.ScoreboardGameStateFinal {
		t.Errorf("final, out and bye read %s, want final", got)
	}
	if got := done.toPlay(done.state()); got != nil {
		t.Errorf("a final card counts %q", *got)
	}
	playing := countOf(startedAt(final, ""), startedAt(live, apitypes.DesignationStatusQuestionable))
	if got := playing.toPlay(playing.state()); got == nil || *got != "1 playing" {
		t.Errorf("a questionable starter in play reads %v, want 1 playing", got)
	}
	// Before any kickoff an out starter leaves the card upcoming.
	before := countOf(startedAt(ahead, apitypes.DesignationStatusOut), startedAt(ahead, ""))
	if got := before.state(); got != apitypes.ScoreboardGameStateUpcoming {
		t.Errorf("before kickoff %s", got)
	}
}

// The words themselves, by the one table.
func TestToPlayWords(t *testing.T) {
	for _, c := range []struct {
		toPlay, playing int
		want            string
	}{{3, 2, "3 to play"}, {0, 2, "2 playing"}, {0, 0, ""}, {1, 0, "1 to play"}} {
		if got := ToPlayWords(c.toPlay, c.playing); got != c.want {
			t.Errorf("ToPlayWords(%d, %d) = %q, want %q", c.toPlay, c.playing, got, c.want)
		}
	}
}
