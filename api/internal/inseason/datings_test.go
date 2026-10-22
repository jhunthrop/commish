package inseason

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The shared datings (app.designation_datings, migration 00029): a dating
// kept reads back whole, the first writer of a digest wins and is never
// replaced, an unknown digest is none kept, and a write deletes the
// datings of captures over DatingsKept older than its own.
func TestPGDatingsKeepsTheFirstDatingOfEachCapture(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	store := &PGDatings{Pool: pool}
	at := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	capture := map[string]boards.Designation{"p1": {Code: "IR", AsOf: at}, "p2": {Code: "Q", AsOf: at}}
	digest := DatingDigest(capture)
	runs := map[boards.RunKey]time.Time{
		{PlayerID: "p1", Status: boards.StatusInjuredReserve}: at.Add(-72 * time.Hour),
		{PlayerID: "p2", Status: boards.StatusQuestionable}:   at.Add(-time.Hour),
	}
	if _, ok, err := store.Dating(ctx, digest); err != nil || ok {
		t.Fatalf("before any write: found %v, %v", ok, err)
	}
	if err := store.KeepDating(ctx, Dating{Digest: digest, CaptureAt: at, Runs: runs, DatedAt: at.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	later := map[boards.RunKey]time.Time{{PlayerID: "p1", Status: boards.StatusInjuredReserve}: at}
	if err := store.KeepDating(ctx, Dating{Digest: digest, CaptureAt: at, Runs: later, DatedAt: at.Add(2 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.Dating(ctx, digest)
	if err != nil || !ok || !reflect.DeepEqual(got, runs) {
		t.Fatalf("kept %v %v %v, want the first writer's %v", got, ok, err, runs)
	}

	newer := map[string]boards.Designation{"p1": {Code: "IR", AsOf: at.Add(DatingsKept + time.Hour)}}
	if err := store.KeepDating(ctx, Dating{Digest: DatingDigest(newer), CaptureAt: at.Add(DatingsKept + time.Hour), Runs: map[boards.RunKey]time.Time{}, DatedAt: at}); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Dating(ctx, digest); err != nil || ok {
		t.Fatalf("a dating over DatingsKept older than the newest was kept: %v %v", ok, err)
	}
	if got, ok, err := store.Dating(ctx, DatingDigest(newer)); err != nil || !ok || len(got) != 0 {
		t.Fatalf("an empty dating read back %v %v %v", got, ok, err)
	}
}

// A row that does not read is an error, never a dating: the cache dates
// the capture itself.
func TestPGDatingsRefusesAnIncompleteRow(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	digest := DatingDigest(map[string]boards.Designation{"p1": {Code: "Q"}})
	if _, err := pool.Exec(ctx, `insert into app.designation_datings (capture_digest, capture_at, runs, dated_at)
	values ($1, now(), '[{"player":"p1","status":""}]', now())`, digest); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := (&PGDatings{Pool: pool}).Dating(ctx, digest); err == nil || ok {
		t.Fatalf("an incomplete row read as a dating: %v %v", ok, err)
	}
}
