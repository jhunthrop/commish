package inseason

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// findWait bounds how long a test waits on a finder that should already run.
const findWait = 2 * time.Second

// TestTheFinderRunsOutsideTheCacheLock is review 66j N4: one pair's
// finder never holds up another's, and the lock guards the map only.
func TestTheFinderRunsOutsideTheCacheLock(t *testing.T) {
	var c readCache[map[string]bool]
	started, release := make(chan struct{}), make(chan struct{})
	go func() {
		_, _ = c.get("slow", "x", func() (map[string]bool, error) {
			close(started)
			<-release
			return map[string]bool{"a": true}, nil
		})
	}()
	<-started
	done := make(chan map[string]bool)
	go func() {
		got, _ := c.get("other", "x", func() (map[string]bool, error) { return map[string]bool{"b": true}, nil })
		done <- got
	}()
	select {
	case got := <-done:
		if !got["b"] {
			t.Fatalf("the other pair's value: %v", got)
		}
	case <-time.After(findWait):
		t.Fatal("a second pair waited on the first pair's finder")
	}
	close(release)
}

// TestConcurrentAsksOfOneReadRunTheFinderOnce: the same pair and content
// asked at once runs the finder once and every caller gets its answer.
func TestConcurrentAsksOfOneReadRunTheFinderOnce(t *testing.T) {
	var c readCache[map[string]bool]
	var runs atomic.Int32
	release := make(chan struct{})
	find := func() (map[string]bool, error) {
		runs.Add(1)
		<-release
		return map[string]bool{"a": true}, nil
	}
	const callers = 8
	var wg sync.WaitGroup
	got := make([]map[string]bool, callers)
	for i := range callers {
		wg.Add(1)
		go func() { defer wg.Done(); got[i], _ = c.get("one", "x", find) }()
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if n := runs.Load(); n != 1 {
		t.Fatalf("the finder ran %d times for one read", n)
	}
	for i, g := range got {
		if !g["a"] {
			t.Fatalf("caller %d got %v", i, g)
		}
	}
}

// The cache keeps one latest entry per pair (rereview 66u W4): new content
// replaces the pair's last, a full cache drops only the pair used longest
// ago, and a find that fails keeps nothing.
func TestTheCacheKeepsEachPairsLatestSearch(t *testing.T) {
	var c readCache[int]
	value := func(v int) func() (int, error) { return func() (int, error) { return v, nil } }
	_, _ = c.get("pair", "old", value(1))
	if got, _ := c.get("pair", "new", value(2)); got != 2 || len(c.pairs) != 1 {
		t.Fatalf("new content: %d, %d pairs", got, len(c.pairs))
	}
	if _, ok := c.lookup("pair", "old"); ok {
		t.Fatal("the pair's old search is still kept")
	}
	for i := range maxPairs - 1 {
		_, _ = c.get(fmt.Sprintf("p%d", i), "x", value(i))
	}
	// Use "pair" again so p0 is the one used longest ago.
	_, _ = c.get("pair", "new", value(0))
	_, _ = c.get("one more", "x", value(9))
	if len(c.pairs) != maxPairs {
		t.Fatalf("%d pairs kept, want %d", len(c.pairs), maxPairs)
	}
	if _, ok := c.lookup("p0", "x"); ok {
		t.Fatal("the pair used longest ago is still kept")
	}
	if _, ok := c.lookup("pair", "new"); !ok {
		t.Fatal("a pair used lately was dropped")
	}
	if _, err := c.get("failed", "x", func() (int, error) { return 0, errors.New("stopped") }); err == nil {
		t.Fatal("a failed find answered no error")
	}
	if _, ok := c.lookup("failed", "x"); ok {
		t.Fatal("a failed find was kept")
	}
}
