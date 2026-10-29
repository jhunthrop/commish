package inseason

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The league's shape is content: a changed slot or bench searches again
// (rereview 66u F1).
func TestALeagueShapeChangeIsNewContent(t *testing.T) {
	f := newFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	before := contentKey(a)
	bench := *a
	bench.config = append([]draft.SlotConfig(nil), a.config...)
	for i := range bench.config {
		if bench.config[i].Slot == draft.SlotBench {
			bench.config[i].Count++
		}
	}
	if contentKey(&bench) == before {
		t.Fatal("a bigger bench leaves the content unchanged")
	}
	settings := *a
	settings.settings.Roster.Bench++
	if contentKey(&settings) == before {
		t.Fatal("changed saved settings leave the content unchanged")
	}
	if contentKey(a) != before {
		t.Fatal("the content key is not stable")
	}
	// A game moved to another week moves a bye (Lane 287 fix round, LOW-3).
	moved := *a
	moved.plays = map[string]uint32{}
	for _, p := range a.Board.Raw.Players {
		moved.plays[p.Team] = a.plays[p.Team] ^ PlaysIn([]int{9})
	}
	if contentKey(&moved) == before {
		t.Fatal("a moved game leaves the content unchanged")
	}
}

// tradesOf is the trades a /trades answer lists across teams.
func tradesOf(t *testing.T, env envelope) int {
	t.Helper()
	var out apitypes.TradeAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, team := range out.Teams {
		n += len(team.Trades)
	}
	return n
}

// A request during the drain (main's context already cancelled, as at
// SIGTERM) still finishes its search; a search past its deadline answers
// 503 in our words, never an empty table (rereview 66u F2).
func TestAStoppedSearchIsNeverNoTrades(t *testing.T) {
	f := newFixture(t)
	t.Run("SIGTERM: the drain still searches", func(t *testing.T) {
		s := fixtureService(t, f.league, f.data, &fakeHolds{})
		ctx, stop := context.WithCancel(context.Background())
		stop()
		s.Context = ctx
		code, env := serve(t, s, leaguePath+"trades")
		if code != http.StatusOK || tradesOf(t, env) == 0 {
			t.Fatalf("during the drain: %d with %d trades", code, tradesOf(t, env))
		}
	})
	t.Run("the deadline: 503 in our words", func(t *testing.T) {
		s := fixtureService(t, f.league, f.data, &fakeHolds{})
		s.SearchTimeout = time.Nanosecond
		for _, route := range []string{"trades", "order"} {
			code, env := serve(t, s, leaguePath+route)
			if code != http.StatusServiceUnavailable || env.Error == nil || env.Error.Message != SearchStoppedWords {
				t.Fatalf("%s past the deadline: %d %+v", route, code, env.Error)
			}
		}
	})
}

// The viewer set forgets views past the window on every record and holds
// at most maxViewedLeagues leagues (rereview 66u F3).
func TestTheViewerSetIsBounded(t *testing.T) {
	var v viewerSet
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	old := leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: "old", Season: 2026}
	v.saw(old, signedIn, now.Add(-leaguesync.ViewWindow-time.Minute))
	v.saw(leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: "new", Season: 2026}, signedIn, now)
	if _, kept := v.seen[old.Key()]; kept {
		t.Fatal("a view past the window was kept")
	}
	for i := range maxViewedLeagues + 10 {
		v.saw(leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: fmt.Sprint(i), Season: 2026}, signedIn, now.Add(time.Duration(i)*time.Millisecond))
	}
	if n := len(v.seen); n > maxViewedLeagues {
		t.Fatalf("%d leagues held, at most %d", n, maxViewedLeagues)
	}
}

// gate holds the first search until released, saying when it is held.
type gate struct {
	once    sync.Once
	held    chan struct{}
	release chan struct{}
}

func newGate() *gate { return &gate{held: make(chan struct{}), release: make(chan struct{})} }

func (g *gate) wait() {
	first := false
	g.once.Do(func() { first = true })
	if first {
		close(g.held)
		<-g.release
	}
}

// overlap is a warmed fixture whose order then refreshes, its warm search
// held at the gate, and a request started while it is held.
func overlap(t *testing.T, warm context.Context) (*Service, *gate, chan envelope) {
	t.Helper()
	s, f, landings := warmFixture(t)
	changed := f.league
	changed.Board.Refreshed = changed.Board.Refreshed.Add(time.Hour)
	landings.set(changed)
	s.Leagues = fakeLeagues{changed}
	g := newGate()
	s.beforeSearch = g.wait
	go s.Warm(warm, changed.Snap.Ref)
	<-g.held
	done := make(chan envelope, 1)
	go func() {
		code, env := serve(t, s, leaguePath+"trades")
		if code != http.StatusOK {
			t.Errorf("trades: %d %+v", code, env.Error)
		}
		done <- env
	}()
	// The request reaches the search and joins the held run.
	time.Sleep(100 * time.Millisecond)
	return s, g, done
}

// A request that arrives while a warm search runs waits for that run and
// reads it: one search for the read in all (rereview 66u F4).
func TestARequestOverlappingAWarmSharesIt(t *testing.T) {
	s, g, done := overlap(t, context.Background())
	if n := s.searches.Load(); n != 2 {
		t.Fatalf("the request started its own search: %d", n)
	}
	close(g.release)
	if env := <-done; tradesOf(t, env) == 0 {
		t.Fatal("the shared search answered no trades")
	}
	if n := s.searches.Load(); n != 2 {
		t.Fatalf("%d searches in all, want 2 (one each read)", n)
	}
}

// A shared run the warm's deadline stops is run again on the request's
// own context, so the request still answers its trades (rereview 66u F4).
func TestARequestRerunsASharedRunTheWarmStopped(t *testing.T) {
	warm, stopWarm := context.WithCancel(context.Background())
	s, g, done := overlap(t, warm)
	stopWarm()
	close(g.release)
	if env := <-done; tradesOf(t, env) == 0 {
		t.Fatal("the rerun answered no trades")
	}
	if n := s.searches.Load(); n != 3 {
		t.Fatalf("%d searches in all, want 3 (the first view, the stopped warm, the rerun)", n)
	}
}
