package inseason

import (
	"strings"
	"testing"
)

// askedCut is a page cut short of the fixture's pool, so a player past it
// stands for a free player past MaxWaiverRows in a full league.
const askedCut = 10

// TestTheWaiverPageKeepsTheAskedPlayerPastTheCut is review 66j N2: the order
// marks every free player its league starts as an add, out past the page's
// cut, so a link naming one (?player=) finds his row on Waivers.
func TestTheWaiverPageKeepsTheAskedPlayerPastTheCut(t *testing.T) {
	f := newFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	run, ok := a.waiverRun("")
	if !ok {
		t.Fatal("no waiver run")
	}
	if len(run.moves) <= askedCut {
		t.Fatalf("the pool holds %d adds, within the cut, so the test proves nothing", len(run.moves))
	}
	deep := run.moves[len(run.moves)-1]
	asked := boardID(run.pool[deep.Add].line)
	if asked == "" {
		t.Fatal("the deepest add has no board id")
	}
	page := pageMoves(run.moves, run.pool, asked, askedCut)
	if len(page) != askedCut+1 || page[askedCut].Add != deep.Add {
		t.Fatalf("the page carries %d moves, his not last", len(page))
	}
	inside := boardID(run.pool[run.moves[0].Add].line)
	for _, other := range []string{"", inside, "nobody"} {
		if got := pageMoves(run.moves, run.pool, other, askedCut); len(got) != askedCut {
			t.Fatalf("asking for %q carries %d moves", other, len(got))
		}
	}
	// The page itself: his row is on it, once.
	out, ok := a.Waivers("", asked)
	if !ok {
		t.Fatal("no waivers")
	}
	found := 0
	for _, r := range out.Rows {
		if boardID(r.Add) == asked {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("the asked player's row shows %d times", found)
	}
}

// TestTheWaiversRouteTakesTheAskedPlayer: ?player= past its bound is refused,
// an unknown one changes nothing.
func TestTheWaiversRouteTakesTheAskedPlayer(t *testing.T) {
	f := restOfSeasonFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	if code, _ := serve(t, s, leaguePath+"waivers?player="+strings.Repeat("x", maxPlayerParam+1)); code != 400 {
		t.Fatalf("a long player: %d", code)
	}
	if code, _ := serve(t, s, leaguePath+"waivers?player=nobody"); code != 200 {
		t.Fatalf("an unknown player: %d", code)
	}
}
