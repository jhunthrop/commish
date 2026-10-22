package inseason

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// memDatings is the shared datings in memory, as two instances against
// one database see them.
type memDatings struct {
	mu      sync.Mutex
	kept    map[string]Dating
	lookups atomic.Int32
	writes  atomic.Int32
	down    bool
}

func (m *memDatings) Dating(_ context.Context, digest string) (map[boards.RunKey]time.Time, bool, error) {
	m.lookups.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.down {
		return nil, false, errors.New("datings down")
	}
	d, ok := m.kept[digest]
	return d.Runs, ok, nil
}

func (m *memDatings) KeepDating(_ context.Context, d Dating) error {
	m.writes.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.down {
		return errors.New("datings down")
	}
	if m.kept == nil {
		m.kept = map[string]Dating{}
	}
	if _, ok := m.kept[d.Digest]; !ok {
		m.kept[d.Digest] = d
	}
	return nil
}

// A fresh instance answers dated statuses at once when another instance
// has dated the newest capture (Lane 133 ruling 1, B110): its first
// request reads the shared row, never the runs, and says so in its log.
func TestAFreshInstanceAnswersTheSharedDatingAtOnce(t *testing.T) {
	shared := &memDatings{}
	ctx := context.Background()
	first := &Cache{Reads: &countingReads{}, Now: time.Now, Datings: shared}
	if d, err := first.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
		t.Fatalf("the first instance, cold: %+v %v, want pending", d["p2"], err)
	}
	first.refreshes.Wait()
	if shared.writes.Load() != 1 {
		t.Fatalf("%d shared writes, want the first instance's dating kept once", shared.writes.Load())
	}

	var logged bytes.Buffer
	reads := &countingReads{}
	fresh := &Cache{Reads: reads, Now: time.Now, Datings: shared, Log: slog.New(slog.NewTextHandler(&logged, nil))}
	start := time.Now()
	d, err := fresh.DatedDesignations(ctx)
	if took := time.Since(start); err != nil || took > 100*time.Millisecond {
		t.Fatalf("the fresh instance took %v: %v", took, err)
	}
	if d["p2"].DatingPending || d["p2"].Since == nil || !d["p2"].Since.Equal(captureAt.Add(-time.Hour)) {
		t.Fatalf("the fresh instance's first answer %+v, want dated", d["p2"])
	}
	fresh.refreshes.Wait()
	if n := reads.runs.Load(); n != 0 {
		t.Fatalf("the fresh instance read the runs %d times, want none", n)
	}
	if !strings.Contains(logged.String(), "dated from the shared row") || !strings.Contains(logged.String(), DatingsTable) {
		t.Fatalf("no log line names the shared row: %s", logged.String())
	}
	if d, err = fresh.DatedDesignations(ctx); err != nil || d["p2"].DatingPending || shared.lookups.Load() != 3 {
		t.Fatalf("again: %+v %v after %d lookups, want the kept pair and no lookup past the third", d["p2"], err, shared.lookups.Load())
	}
}

// The capture answers pending only while no instance has dated it: the
// requests look for its shared dating once between them, the dating read
// behind them looks again before it reads the runs, and once it lands
// the pair answers.
func TestPendingOnlyUntilSomeInstanceDatesTheCapture(t *testing.T) {
	shared := &memDatings{}
	reads := &slowRuns{took: 100 * time.Millisecond}
	c := &Cache{Reads: reads, Now: time.Now, Datings: shared}
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if d, err := c.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
			t.Fatalf("request %d before any dating: %+v %v, want pending", i, d["p2"], err)
		}
	}
	c.refreshes.Wait()
	if n := shared.lookups.Load(); n != 2 {
		t.Fatalf("%d shared lookups, want one by the requests and one by the dating", n)
	}
	d, err := c.DatedDesignations(ctx)
	if err != nil || d["p2"].DatingPending || d["p2"].Since == nil {
		t.Fatalf("once dated: %+v %v", d["p2"], err)
	}
	if reads.runs.Load() != 1 || shared.writes.Load() != 1 {
		t.Fatalf("%d runs reads and %d shared writes, want one each", reads.runs.Load(), shared.writes.Load())
	}
}

// A shared store that is down costs the dating nothing but a log line:
// the capture is dated here, as before Lane 133.
func TestADownSharedStoreDatesTheCaptureHere(t *testing.T) {
	shared := &memDatings{down: true}
	var logged bytes.Buffer
	reads := &countingReads{}
	c := &Cache{Reads: reads, Now: time.Now, Datings: shared, Log: slog.New(slog.NewTextHandler(&logged, nil))}
	ctx := context.Background()
	if d, err := c.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
		t.Fatalf("cold, store down: %+v %v", d["p2"], err)
	}
	c.refreshes.Wait()
	if d, err := c.DatedDesignations(ctx); err != nil || d["p2"].DatingPending || d["p2"].Since == nil {
		t.Fatalf("store down, dated here: %+v %v", d["p2"], err)
	}
	if !strings.Contains(logged.String(), "was not read") || !strings.Contains(logged.String(), "was not shared") {
		t.Fatalf("the store's failures were not logged: %s", logged.String())
	}
}

// A pair is as fresh as its capture (Lane 133 ruling 2, Lane 129 review
// MEDIUM-1). An instance idle past PairMaxAge holds a stale pair and an
// equally stale capture; the next request answers the stale capture
// pending and dates the newest capture behind it, never the stale one, so
// the pair that lands holds the newest capture's Out, not the stale
// Questionable stamped as fresh.
func TestAStaleCaptureIsNeverDatedAsFresh(t *testing.T) {
	friday := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	reads := &movingCaptures{}
	reads.capture(friday, "Q")
	clock := &lockedClock{now: friday.Add(time.Minute)}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if _, err := c.DatedDesignations(ctx); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
	reads.capture(friday.Add(3*time.Hour), "O")
	clock.add(3 * time.Hour)
	if d, err := c.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
		t.Fatalf("past PairMaxAge: %+v %v, want the kept capture pending", d["p2"], err)
	}
	c.refreshes.Wait()
	d, err := c.DatedDesignations(ctx)
	if err != nil || d["p2"].Code != "O" || d["p2"].DatingPending || d["p2"].Listed == nil || !d["p2"].Listed.Equal(friday.Add(3*time.Hour)) {
		t.Fatalf("after the dating lands: %+v %v, want the newest capture's Out, dated", d["p2"], err)
	}
}

// A pair's age runs from its capture's read, not from when its dating
// landed: a dating that lands a TTL after its capture was read answers,
// and the next request refreshes it behind at once.
func TestAPairsAgeIsItsCapturesAge(t *testing.T) {
	friday := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	reads := &movingCaptures{}
	reads.capture(friday, "Q")
	reads.gate = make(chan struct{})
	clock := &lockedClock{now: friday.Add(time.Minute)}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if _, err := c.DatedDesignations(ctx); err != nil {
		t.Fatal(err)
	}
	clock.add(CaptureTTL + time.Minute)
	reads.mu.Lock()
	close(reads.gate)
	reads.gate = nil
	reads.mu.Unlock()
	c.refreshes.Wait()
	if d, err := c.DatedDesignations(ctx); err != nil || d["p2"].DatingPending || d["p2"].Listed == nil {
		t.Fatalf("the late pair: %+v %v, want it answering", d["p2"], err)
	}
	c.refreshes.Wait()
	if n := reads.runs.Load(); n != 2 {
		t.Fatalf("%d runs reads, want the late pair refreshed at once (2)", n)
	}
}

// The digest follows the capture: its stamp and each player's status, in
// any map order; a note alone does not change the dating.
func TestDatingDigest(t *testing.T) {
	at := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	base := map[string]boards.Designation{"p1": {Code: "Q", AsOf: at}, "p2": {Code: "IR", AsOf: at}}
	same := map[string]boards.Designation{"p2": {Code: "IR", AsOf: at, Note: "knee"}, "p1": {Code: "Q", AsOf: at}}
	if DatingDigest(base) != DatingDigest(same) {
		t.Fatal("the same capture digests apart")
	}
	for name, other := range map[string]map[string]boards.Designation{
		"stamp":  {"p1": {Code: "Q", AsOf: at.Add(time.Hour)}, "p2": {Code: "IR", AsOf: at}},
		"status": {"p1": {Code: "O", AsOf: at}, "p2": {Code: "IR", AsOf: at}},
		"player": {"p1": {Code: "Q", AsOf: at}},
	} {
		if DatingDigest(other) == DatingDigest(base) {
			t.Errorf("a capture differing by %s digests the same", name)
		}
	}
	if len(DatingDigest(base)) != 64 {
		t.Fatalf("digest %q is not 64 hex", DatingDigest(base))
	}
}
