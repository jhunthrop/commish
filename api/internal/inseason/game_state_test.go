package inseason

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// A game has three states on every screen (Lane 80): upcoming before its
// kickoff, kicked off from its kickoff until its final is in, final once the
// store holds its result or a line from either side (Lane 66s).
func TestGameStateAt(t *testing.T) {
	kickoff := sundayKickoff
	cases := []struct {
		name  string
		game  boards.TeamWeek
		now   time.Time
		state apitypes.GameState
	}{
		{"before kickoff", boards.TeamWeek{Kickoff: kickoff}, kickoff.Add(-time.Minute), apitypes.GameStateUpcoming},
		{"at kickoff", boards.TeamWeek{Kickoff: kickoff}, kickoff, apitypes.GameStateKickedOff},
		{"the Monday after, no final", boards.TeamWeek{Kickoff: kickoff}, kickoff.Add(20 * time.Hour), apitypes.GameStateKickedOff},
		{"final", boards.TeamWeek{Kickoff: kickoff, Final: true}, kickoff.Add(40 * time.Hour), apitypes.GameStateFinal},
		{"final before its kickoff by the clock", boards.TeamWeek{Kickoff: kickoff, Final: true}, kickoff.Add(-time.Hour), apitypes.GameStateFinal},
	}
	for _, c := range cases {
		if got := gameStateAt(c.game, c.now); got != c.state {
			t.Errorf("%s: %s, want %s", c.name, got, c.state)
		}
	}
}

// On the Monday after Sunday's games, Thursday's game is final (its lines
// are in) and Sunday's has kicked off with no final: the facts, the wire and
// the game week say so, and Played and Locked follow the one state.
func TestTheMondayAfterSundayKickedOffThursdayFinal(t *testing.T) {
	monday := sundayKickoff.Add(20 * time.Hour)
	c := &Cache{Reads: &thursdayReads{}, Now: func() time.Time { return monday }}
	d, err := c.Data(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	season := NewSeason(d, RulesOf(scoring.PresetRules(pprPreset)), 6, monday)
	thursday := season.For(Player{BoardID: "jsn", Team: "SEA", Position: draft.WR})
	sunday := season.For(Player{BoardID: "allen", Team: "BUF", Position: draft.QB})
	if thursday.State != apitypes.GameStateFinal || !thursday.Played || !thursday.Locked {
		t.Fatalf("Thursday's game: %s", thursday)
	}
	if sunday.State != apitypes.GameStateKickedOff || sunday.Played || !sunday.Locked {
		t.Fatalf("Sunday's game: %s", sunday)
	}
	if w := wireFacts(sunday, nil); w.GameState == nil || *w.GameState != apitypes.GameStateKickedOff {
		t.Fatalf("Sunday's wire state %v", w.GameState)
	}
	states := map[string]apitypes.GameState{}
	for _, g := range gameWeek(d, 2026, 6, monday).Games {
		if g.GameState == nil {
			t.Fatalf("%s has no state", g.Team)
		}
		states[g.Team] = *g.GameState
	}
	if states["SEA"] != apitypes.GameStateFinal || states["BUF"] != apitypes.GameStateKickedOff {
		t.Fatalf("the game week's states %v", states)
	}
}

// A player whose club we do not know has no game and so no state: the
// wire's field is null, never a guessed upcoming.
func TestNoGameNoState(t *testing.T) {
	c := &Cache{Reads: &thursdayReads{}, Now: func() time.Time { return sundayKickoff }}
	d, err := c.Data(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	f := NewSeason(d, RulesOf(scoring.PresetRules(pprPreset)), 6, sundayKickoff).For(Player{BoardID: "x", Position: draft.WR})
	if f.State != "" || wireFacts(f, nil).GameState != nil {
		t.Fatalf("no club, state %q", f.State)
	}
}
