package inseason

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// findWait bounds how long a test waits on a finder that should already run.
const findWait = 2 * time.Second

// TestTheFinderRunsOutsideTheCacheLock is review 66j N4: one league read's
// finder never holds up another's, and the lock guards the map only.
func TestTheFinderRunsOutsideTheCacheLock(t *testing.T) {
	var c readCache[map[string]bool]
	started, release := make(chan struct{}), make(chan struct{})
	go c.get("slow", func() map[string]bool {
		close(started)
		<-release
		return map[string]bool{"a": true}
	})
	<-started
	done := make(chan map[string]bool)
	go func() { done <- c.get("other", func() map[string]bool { return map[string]bool{"b": true} }) }()
	select {
	case got := <-done:
		if !got["b"] {
			t.Fatalf("the other read's targets: %v", got)
		}
	case <-time.After(findWait):
		t.Fatal("a second league read waited on the first read's finder")
	}
	close(release)
}

// TestConcurrentAsksOfOneReadRunTheFinderOnce: the same read asked at once
// runs the finder once and every caller gets its answer.
func TestConcurrentAsksOfOneReadRunTheFinderOnce(t *testing.T) {
	var c readCache[map[string]bool]
	var runs atomic.Int32
	release := make(chan struct{})
	find := func() map[string]bool {
		runs.Add(1)
		<-release
		return map[string]bool{"a": true}
	}
	const callers = 8
	var wg sync.WaitGroup
	got := make([]map[string]bool, callers)
	for i := range callers {
		wg.Add(1)
		go func() { defer wg.Done(); got[i] = c.get("one", find) }()
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
