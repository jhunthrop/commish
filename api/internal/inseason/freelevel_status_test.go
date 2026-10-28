package inseason

import (
	"sort"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A dropped star on injured reserve, ruled out or suspended sets no
// level (rereview MEDIUM-A): the level is the best free agent the
// Waivers table lists as a pickup. The best free back is listed each way
// in turn, above every healthy one, and the level stays the healthy best.
func TestAnInjuredFreeAgentSetsNoLevel(t *testing.T) {
	f := newFixture(t)
	healthy := newFixtureAdvisor(t, f, nil)
	pool := healthy.pool(draft.RB)
	sort.SliceStable(pool, func(i, j int) bool { return pool[i].cand.Value > pool[j].cand.Value })
	if len(pool) < 2 || !pool[0].cand.HasValue || pool[0].cand.Value <= pool[1].cand.Value {
		t.Fatalf("the fixture's free backs %d, so the test proves nothing", len(pool))
	}
	star, best, next := *pool[0].line.Player.BoardId, pool[0].cand.Value, pool[1].cand.Value
	if got := healthy.levels().of(draft.RB); got != best {
		t.Fatalf("the healthy level %v, the best free back %v", got, best)
	}
	asOf := fixtureNow.Add(-24 * time.Hour)
	for _, code := range []string{"IR", "O", "SUSP"} {
		f.data.Designations[star] = boards.Designation{Code: code, AsOf: asOf}
		a := newFixtureAdvisor(t, f, nil)
		if got := a.levels().of(draft.RB); got != next {
			t.Fatalf("%s: the level %v, want the healthy best %v, not the star's %v", code, got, next, best)
		}
	}
	// A questionable star still plays, so he still sets it.
	f.data.Designations[star] = boards.Designation{Code: "Q", AsOf: asOf}
	if got := newFixtureAdvisor(t, f, nil).levels().of(draft.RB); got != best {
		t.Fatalf("questionable: the level %v, want %v", got, best)
	}
}

// A position with no free agent a side could start is named in its own
// sentence (rereview LOW-A); the others keep the waiver level.
func TestTheLineNamesEachPositionWithNoFreeAgent(t *testing.T) {
	h := Horizon{Last: LastWeek}
	got := RestOfSeasonBasis(RestOfSeason, 9, h, true, true, []draft.Position{draft.QB})
	want := "Rest of season is what the players a side gets score over the best free agent at their position, less the same for those it gives and drops, weeks 9 to 17. " +
		"At QB it is over the last starter league-wide, as the league has no free quarterback. We list a trade only when neither side falls by more than 9.0."
	if got != want {
		t.Fatalf("%q", got)
	}
	if two := lackingWords([]draft.Position{draft.QB, draft.TE}); two != "At QB and TE it is over the last starter league-wide, as the league has no free quarterback or tight end." {
		t.Fatalf("%q", two)
	}
}
