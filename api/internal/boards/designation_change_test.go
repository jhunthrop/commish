package boards

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// injList is a by-date capture listing each id under the code, with
// filler players so the floor reads it like a real list.
func injList(codes map[string]string, filler int) string {
	var entries []string
	for id, code := range codes {
		entries = append(entries, fmt.Sprintf(`{"playerID": %q, "designation": %q}`, id, code))
	}
	for i := range filler {
		entries = append(entries, fmt.Sprintf(`{"playerID": "f%d", "designation": "Q"}`, i))
	}
	return `{"injList": [` + strings.Join(entries, ", ") + `]}`
}

// The pairs are each two consecutive captures that read, oldest first,
// from the window; a cut-short list between them is passed over, never
// read as everyone cleared; a source with one capture has no pair.
func TestDesignationPairs(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "lane262_pair"
	at := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src := &PGSource{Pool: pool, Schema: schema}
	insert := func(payload string, when time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `insert into `+schema+`.capture_snapshots values ('tank01_injuries_by_date', $1, $2)`, payload, when); err != nil {
			t.Fatal(err)
		}
	}

	insert(injList(map[string]string{"p1": "Q"}, 20), at)
	if pairs, err := src.DesignationPairs(ctx, time.Time{}); err != nil || len(pairs) != 0 {
		t.Fatalf("one capture made pairs: %v %v", pairs, err)
	}
	insert(injList(map[string]string{"p2": "O"}, 0), at.Add(time.Hour)) // cut short: under half
	insert(injList(map[string]string{"p1": "Q", "p2": "O"}, 20), at.Add(2*time.Hour))
	insert(injList(map[string]string{"p2": "O"}, 20), at.Add(3*time.Hour))

	pairs, err := src.DesignationPairs(ctx, time.Time{})
	if err != nil || len(pairs) != 2 {
		t.Fatalf("pairs %v %v", len(pairs), err)
	}
	pair, last := pairs[0], pairs[1]
	if !last.OlderAt.Equal(at.Add(2*time.Hour)) || !last.NewerAt.Equal(at.Add(3*time.Hour)) {
		t.Fatalf("the newest pair compared %v with %v", last.NewerAt, last.OlderAt)
	}
	if within, err := src.DesignationPairs(ctx, at.Add(150*time.Minute)); err != nil || len(within) != 1 || !within[0].NewerAt.Equal(last.NewerAt) {
		t.Fatalf("the window kept %d pairs %v", len(within), err)
	}
	if !pair.NewerAt.Equal(at.Add(2*time.Hour)) || !pair.OlderAt.Equal(at) {
		t.Fatalf("compared %v with %v", pair.NewerAt, pair.OlderAt)
	}
	if pair.Newer["p2"].Status() != StatusOut || pair.Older["p1"].Status() != StatusQuestionable {
		t.Fatalf("newer %v older %v", pair.Newer["p2"], pair.Older["p1"])
	}
	if _, listed := pair.Older["p2"]; listed {
		t.Fatal("the short list was read as the older capture")
	}
}
