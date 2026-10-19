package inseason

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// signedIn is the account serve signs every request in as.
var signedIn = uuid.MustParse("00000000-0000-0000-0000-00000000000a")

// fakeLandings answers a landed read with its league for each account
// asked for that follows it.
type fakeLandings struct {
	mu      sync.Mutex
	league  League
	follows map[uuid.UUID]bool
}

func (f *fakeLandings) Landed(_ context.Context, _ leaguesync.Ref, accounts []uuid.UUID) ([]Landed, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Landed
	for _, a := range accounts {
		if f.follows[a] {
			out = append(out, Landed{Account: a, League: f.league})
		}
	}
	return out, nil
}

func (f *fakeLandings) set(l League) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.league = l
}

// warmFixture is the fixture league's service, its signed-in account
// following the league and having viewed it once (one search).
func warmFixture(t *testing.T) (*Service, fixture, *fakeLandings) {
	t.Helper()
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	landings := &fakeLandings{league: f.league, follows: map[uuid.UUID]bool{signedIn: true}}
	s.Landings = landings
	if code, _ := serve(t, s, leaguePath+"trades"); code != http.StatusOK {
		t.Fatalf("trades: %d", code)
	}
	if n := s.searches.Load(); n != 1 {
		t.Fatalf("the first view searched %d times", n)
	}
	return s, f, landings
}

// A landed read warms the trade search for the account that viewed the
// league, so the search for the new read is kept before any request and
// the request that follows reads it; a landed read whose rosters, holds,
// projection and order are unchanged keeps the search it has (coordinator's
// ruling, rereview 66u W1).
func TestALandedReadWarmsTheTradeSearch(t *testing.T) {
	s, f, landings := warmFixture(t)
	unchanged := f.league
	unchanged.Snap.ReadAt = unchanged.Snap.ReadAt.Add(time.Minute)
	landings.set(unchanged)
	s.Warm(context.Background(), f.league.Snap.Ref)
	if n := s.searches.Load(); n != 1 {
		t.Fatalf("an unchanged read searched again: %d", n)
	}
	changed := f.league
	changed.Board.Refreshed = changed.Board.Refreshed.Add(time.Hour)
	landings.set(changed)
	s.Warm(context.Background(), f.league.Snap.Ref)
	if n := s.searches.Load(); n != 2 {
		t.Fatalf("a refreshed order searched %d times in all, want 2", n)
	}
	a, err := s.leagueAdvisor(context.Background(), changed, signedIn, context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s.finds.lookup(pairKey(a, signedIn.String()), contentKey(a)); !ok {
		t.Fatal("the warm kept no search for the new read")
	}
	// The member's next request reads it.
	s.Leagues = fakeLeagues{changed}
	if code, _ := serve(t, s, leaguePath+"trades"); code != http.StatusOK {
		t.Fatalf("trades: %d", code)
	}
	if n := s.searches.Load(); n != 2 {
		t.Fatalf("the request searched again: %d", n)
	}
}

// Only the accounts that viewed the league are warmed, and a league the
// screens refuse is left to its route.
func TestAWarmIsForTheLeaguesViewersAlone(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Landings = &fakeLandings{league: f.league, follows: map[uuid.UUID]bool{signedIn: true}}
	s.Warm(context.Background(), f.league.Snap.Ref)
	if n := s.searches.Load(); n != 0 {
		t.Fatalf("no one viewed the league, yet %d searches", n)
	}
	refused := f.league
	refused.Saved = nil
	s.Landings = &fakeLandings{league: refused, follows: map[uuid.UUID]bool{signedIn: true}}
	s.viewers.saw(refused.Snap.Ref, signedIn, s.Now())
	s.Warm(context.Background(), refused.Snap.Ref)
	if n := s.searches.Load(); n != 0 {
		t.Fatalf("a refused league was searched %d times", n)
	}
	// A view older than the window is forgotten.
	s.viewers.saw(f.league.Snap.Ref, signedIn, s.Now().Add(-leaguesync.ViewWindow-time.Minute))
	if got := s.viewers.recent(f.league.Snap.Ref, s.Now()); len(got) != 0 {
		t.Fatalf("an old view counts: %v", got)
	}
}

// A request arriving while a landed read's warm run searches shares the
// run: one search in all (rereview 66u W6, through OnLanded).
func TestARequestSharesARunningWarm(t *testing.T) {
	s, f, landings := warmFixture(t)
	changed := f.league
	changed.Board.Refreshed = changed.Board.Refreshed.Add(time.Hour)
	landings.set(changed)
	s.Leagues = fakeLeagues{changed}
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	s.Context = ctx
	s.OnLanded(changed.Snap)
	if code, _ := serve(t, s, leaguePath+"trades"); code != http.StatusOK {
		t.Fatalf("trades: %d", code)
	}
	waitFor(t, func() bool { return s.idle() })
	if n := s.searches.Load(); n != 2 {
		t.Fatalf("the warm and the request searched %d times in all, want 2 (one each read)", n)
	}
}

// blockingLandings holds every Landed until released, counting how many
// run at once.
type blockingLandings struct {
	release  chan struct{}
	inflight atomic.Int32
	most     atomic.Int32
	calls    sync.Map
	total    atomic.Int32
}

func (b *blockingLandings) Landed(_ context.Context, ref leaguesync.Ref, _ []uuid.UUID) ([]Landed, error) {
	n := b.inflight.Add(1)
	for {
		m := b.most.Load()
		if n <= m || b.most.CompareAndSwap(m, n) {
			break
		}
	}
	<-b.release
	b.inflight.Add(-1)
	b.total.Add(1)
	count, _ := b.calls.LoadOrStore(ref.Key(), new(atomic.Int32))
	count.(*atomic.Int32).Add(1)
	return nil, nil
}

// Fifty leagues landing at once run through the two workers, never more
// at a time, and a league that lands again while queued runs once more,
// not once per landing (coordinator's ruling, rereview 66u W1).
func TestFiftyLandingsRunThroughTwoWorkers(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	s.Context = ctx
	block := &blockingLandings{release: make(chan struct{})}
	s.Landings = block
	refs := make([]leaguesync.Ref, 50)
	for i := range refs {
		refs[i] = leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: fmt.Sprintf("league-%d", i), Season: 2026}
		s.viewers.saw(refs[i], signedIn, s.Now())
		s.OnLanded(leaguesync.Snapshot{Ref: refs[i]})
	}
	// The last league lands twice more while it waits: one run.
	s.OnLanded(leaguesync.Snapshot{Ref: refs[49]})
	s.OnLanded(leaguesync.Snapshot{Ref: refs[49]})
	waitFor(t, func() bool { return block.inflight.Load() == warmWorkers })
	close(block.release)
	waitFor(t, func() bool { return block.total.Load() == 50 && s.idle() })
	if m := block.most.Load(); m != warmWorkers {
		t.Fatalf("%d warm runs at once, want %d", m, warmWorkers)
	}
	last, _ := block.calls.Load(refs[49].Key())
	if n := last.(*atomic.Int32).Load(); n != 1 {
		t.Fatalf("a league landing three times while queued ran %d times", n)
	}
}

// waitFor polls cond until it holds or findWait passes.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(findWait); !cond(); {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(time.Millisecond)
	}
}
