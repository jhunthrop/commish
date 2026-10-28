package weekreads

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// countingReader answers a row or an error and counts the reads.
type countingReader struct {
	mu    sync.Mutex
	row   *Row
	err   error
	reads int
}

func (c *countingReader) Read(context.Context, string, int, int) (*Row, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reads++
	return c.row, c.err
}

func (c *countingReader) set(row *Row, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.row, c.err = row, err
}

type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

var written = time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC)

func TestAReadIsKeptAMinute(t *testing.T) {
	ctx := context.Background()
	c := &clock{at: written}
	reader := &countingReader{row: &Row{Week: 8, Body: "Night's read.", WrittenAt: written}}
	live := &Live{Reader: reader, Now: c.now}
	if got := live.Read(ctx, "p1", 2026, 8); got == nil || got.Body != "Night's read." {
		t.Fatalf("first read: %+v", got)
	}
	// The hourly pass rewrites it at 10:00; the kept read answers until its
	// minute is out, the rewrite at 10:01.
	reader.set(&Row{Week: 8, Body: "The rewrite.", WrittenAt: written.Add(time.Hour)}, nil)
	c.at = written.Add(59 * time.Second)
	if got := live.Read(ctx, "p1", 2026, 8); got.Body != "Night's read." || reader.reads != 1 {
		t.Fatalf("within the minute: %+v after %d reads", got, reader.reads)
	}
	c.at = written.Add(time.Minute)
	if got := live.Read(ctx, "p1", 2026, 8); got.Body != "The rewrite." || reader.reads != 2 {
		t.Fatalf("after the minute: %+v after %d reads", got, reader.reads)
	}
	// Each player and week is its own read.
	if live.Read(ctx, "p2", 2026, 8); reader.reads != 3 {
		t.Fatalf("another player: %d reads", reader.reads)
	}
}

func TestNoRowIsKeptAsNone(t *testing.T) {
	ctx := context.Background()
	reader := &countingReader{}
	live := &Live{Reader: reader, Now: (&clock{at: written}).now}
	for range 3 {
		if got := live.Read(ctx, "p1", 2026, 8); got != nil {
			t.Fatalf("no row: %+v", got)
		}
	}
	if reader.reads != 1 {
		t.Fatalf("none kept as none: %d reads", reader.reads)
	}
}

// A failed read answers none and keeps the store unread for a minute,
// every player alike, so a store that is down costs one bounded wait a
// minute (failing-read-on-request-path).
func TestAFailureIsKeptAMinuteForEveryPlayer(t *testing.T) {
	ctx := context.Background()
	c := &clock{at: written}
	reader := &countingReader{err: errors.New("permission denied for table player_week_reads")}
	live := &Live{Reader: reader, Now: c.now}
	if got := live.Read(ctx, "p1", 2026, 8); got != nil {
		t.Fatalf("a failed read: %+v", got)
	}
	reader.set(&Row{Week: 8, Body: "Back.", WrittenAt: written}, nil)
	c.at = written.Add(30 * time.Second)
	for _, id := range []string{"p1", "p2"} {
		if got := live.Read(ctx, id, 2026, 8); got != nil {
			t.Fatalf("%s while failing: %+v", id, got)
		}
	}
	if reader.reads != 1 {
		t.Fatalf("no read while failing: %d reads", reader.reads)
	}
	c.at = written.Add(time.Minute)
	if got := live.Read(ctx, "p1", 2026, 8); got == nil || reader.reads != 2 {
		t.Fatalf("after the minute: %+v after %d reads", got, reader.reads)
	}
}

// slowReader waits for its context: the read's bound ends it.
type slowReader struct{}

func (slowReader) Read(ctx context.Context, _ string, _, _ int) (*Row, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestAReadPastItsBoundIsAFailure(t *testing.T) {
	live := &Live{Reader: slowReader{}, Now: time.Now, Timeout: 20 * time.Millisecond}
	start := time.Now()
	if got := live.Read(context.Background(), "p1", 2026, 8); got != nil {
		t.Fatalf("a read past its bound: %+v", got)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("waited %s", waited)
	}
	if !time.Now().Before(live.failedTill) {
		t.Fatal("the failure is kept")
	}
}

func TestNewPGReaderRefusesABadSchema(t *testing.T) {
	if _, err := NewPGReader(nil, "research; drop"); err == nil {
		t.Fatal("a schema that is not a name")
	}
}

const pgSchema = "weekreads_test"

// The store's read through the crosswalk (migration-free fixture: the two
// research tables the read names, created in a schema of the test's own):
// the written read for the provider id and week, none for a facts block,
// another week or a player with no row.
func TestPGReaderReadsTheWrittenRowThroughTheCrosswalk(t *testing.T) {
	url := dbtest.URL(t)
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+pgSchema+" cascade")
		pool.Close()
	})
	s := pgSchema
	for _, stmt := range []string{
		"drop schema if exists " + s + " cascade",
		"create schema " + s,
		"create table " + s + ".player_crosswalk (provider_player_id text, player_id text)",
		"create table " + s + ".player_week_reads (player_id text, season int, week int, source text, body text, model text, " +
			"written_at timestamptz, facts_at timestamptz, stamps jsonb, projection_points float8, status text, reason text, " +
			"call text, attempt_day date, attempts int, primary key (player_id, season, week))",
		"insert into " + s + ".player_crosswalk values ('p1', 'u1'), ('p2', 'u2'), ('p3', 'u3')",
		"insert into " + s + ".player_week_reads values " +
			"('u1', 2026, 8, 'llm', 'Start him.', 'm', '2026-10-28T15:00:00Z', '2026-10-28T14:30:00Z', '{}', 14.24, 'questionable', 'status', 'start', '2026-10-28', 1), " +
			"('u1', 2026, 7, 'llm', 'Last week.', 'm', '2026-10-21T15:00:00Z', null, '{}', null, null, 'first', 'sit', '2026-10-21', 1), " +
			"('u2', 2026, 8, 'facts', 'Facts block.', null, '2026-10-28T15:00:00Z', null, '{}', null, null, 'first', null, '2026-10-28', 1)",
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	reader, err := NewPGReader(pool, s)
	if err != nil {
		t.Fatal(err)
	}
	row, err := reader.Read(ctx, "p1", 2026, 8)
	if err != nil || row == nil {
		t.Fatalf("p1: %+v %v", row, err)
	}
	if row.Week != 8 || row.Body != "Start him." || *row.Call != "start" || *row.Status != "questionable" ||
		!row.WrittenAt.Equal(time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC)) || row.FactsAt == nil || *row.Projection != 14.24 {
		t.Fatalf("p1's row: %+v", row)
	}
	for _, c := range []struct {
		id   string
		week int
	}{{"p2", 8}, {"p3", 8}, {"p1", 9}, {"nobody", 8}} {
		if row, err := reader.Read(ctx, c.id, 2026, c.week); err != nil || row != nil {
			t.Fatalf("%s week %d: %+v %v", c.id, c.week, row, err)
		}
	}
	// A store without the table fails the read, which Live keeps as a failure.
	if _, err := pool.Exec(ctx, "drop table "+s+".player_week_reads"); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Read(ctx, "p1", 2026, 8); err == nil {
		t.Fatal("no table, no read")
	}
}
