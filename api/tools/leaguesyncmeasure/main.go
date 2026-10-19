// Command leaguesyncmeasure measures league sync's poll cost against the
// live hosts (Lane 11): N viewers each ask for one league every few
// seconds for a while, through the same Poller the api serves, and the
// tool counts the whole reads that went upstream and every HTTP request
// that reached a host. Nothing is written anywhere; the poller's store is
// in memory.
//
//	go run ./tools/leaguesyncmeasure -viewers 25 -every 5s -for 130s
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// countingTransport counts the requests that reach a host.
type countingTransport struct {
	base http.RoundTripper
	n    atomic.Int64
}

func (c *countingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.n.Add(1)
	return c.base.RoundTrip(r)
}

type memoryStore struct {
	mu    sync.Mutex
	snaps map[string]leaguesync.Snapshot
}

func (m *memoryStore) LastSnapshot(_ context.Context, ref leaguesync.Ref) (leaguesync.Snapshot, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snaps[ref.Key()]
	return s, ok, nil
}

func (m *memoryStore) PutSnapshot(_ context.Context, s leaguesync.Snapshot) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.snaps[s.Ref.Key()] = s
	return true, nil
}

func main() {
	viewers := flag.Int("viewers", 25, "viewers per league")
	every := flag.Duration("every", 5*time.Second, "how often each viewer asks")
	length := flag.Duration("for", 130*time.Second, "how long to run")
	flag.Parse()

	sleeperHTTP := &countingTransport{base: http.DefaultTransport}
	mflHTTP := &countingTransport{base: http.DefaultTransport}
	sc := sleeper.New()
	sc.HTTP.Transport = sleeperHTTP
	mc := mfl.New()
	mc.HTTP.Transport = mflHTTP
	hosts := leaguesync.Hosts{&leaguesync.Sleeper{API: sc, Now: time.Now}, &leaguesync.MFL{API: mc, Now: time.Now}}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := &leaguesync.Poller{Hosts: hosts, Store: &memoryStore{snaps: map[string]leaguesync.Snapshot{}}, Now: time.Now, Log: log}
	refs := []leaguesync.Ref{
		{Host: leaguesync.HostSleeper, LeagueID: leaguesync.ReplaySleeperLeague},
		{Host: leaguesync.HostMFL, LeagueID: leaguesync.ReplayMFLLeague, Season: leaguesync.ReplayMFLSeason},
	}
	for _, ref := range refs {
		start := p.Upstream()
		var sh, mh = sleeperHTTP.n.Load(), mflHTTP.n.Load()
		views, latencies, failures := run(p, ref, *viewers, *every, *length)
		reads := p.Upstream() - start
		minutes := length.Minutes()
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
		fmt.Printf("%s: %d viewers every %s for %s: %d views (%d failed), %d whole reads upstream (%.2f a minute), %d host requests (%.1f a minute), view p50 %s p95 %s max %s\n",
			ref.Key(), *viewers, *every, *length, views, failures, reads, float64(reads)/minutes,
			sleeperHTTP.n.Load()-sh+mflHTTP.n.Load()-mh, float64(sleeperHTTP.n.Load()-sh+mflHTTP.n.Load()-mh)/minutes,
			pct(latencies, 50), pct(latencies, 95), latencies[len(latencies)-1])
	}
}

func run(p *leaguesync.Poller, ref leaguesync.Ref, viewers int, every, length time.Duration) (int, []time.Duration, int) {
	var mu sync.Mutex
	var latencies []time.Duration
	failures := 0
	deadline := time.Now().Add(length)
	var wg sync.WaitGroup
	for i := range viewers {
		wg.Go(func() {
			time.Sleep(time.Duration(i) * every / time.Duration(viewers))
			for time.Now().Before(deadline) {
				t := time.Now()
				_, err := p.Read(context.Background(), ref)
				mu.Lock()
				latencies = append(latencies, time.Since(t))
				if err != nil {
					failures++
					fmt.Fprintln(os.Stderr, "view:", err)
				}
				mu.Unlock()
				time.Sleep(every)
			}
		})
	}
	wg.Wait()
	return len(latencies), latencies, failures
}

func pct(sorted []time.Duration, p int) time.Duration {
	return sorted[(len(sorted)-1)*p/100].Round(time.Millisecond)
}
