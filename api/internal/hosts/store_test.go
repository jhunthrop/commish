package hosts

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The re-encrypt job: a row sealed under version 1 opens under version 2
// alone after the job, and a second run finds nothing to do.
func TestRekeyJob(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	acct, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_rekey", Email: "rekey@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	k1, k2 := key(t), key(t)
	v1, _ := NewVault(OneKey(k1))
	sealed, err := v1.Seal(acct.ID.String(), "ffpc", Session{"c": "1"}, SignIn{Username: testUser, Password: testPass})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	if _, err := store.Put(ctx, acct.ID, "ffpc", sealed, time.Now()); err != nil {
		t.Fatal(err)
	}
	rotating, _ := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2, 1: k1}})
	done, skipped, err := Rekey(ctx, store, rotating)
	if err != nil || done != 1 || skipped != 0 {
		t.Fatalf("rekey: %d done, %d skipped, %v", done, skipped, err)
	}
	conn, err := store.Get(ctx, acct.ID, "ffpc")
	if err != nil || conn.Sealed.KeyVersion != 2 {
		t.Fatalf("row at version %d: %v", conn.Sealed.KeyVersion, err)
	}
	v2, _ := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2}})
	if in, err := v2.OpenSignIn(acct.ID.String(), "ffpc", conn.Sealed); err != nil || in.Password != testPass {
		t.Fatalf("version 2 alone: %v", err)
	}
	if done, _, err := Rekey(ctx, store, v2); err != nil || done != 0 {
		t.Fatalf("a second run: %d done, %v", done, err)
	}
}

// Refusals on the connect form are kept across processes and age out.
func TestRefusalsAreKept(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	acct, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_refused", Email: "refused@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	now := time.Now()
	for _, at := range []time.Time{now.Add(-2 * time.Hour), now.Add(-time.Minute), now} {
		if err := store.Refused(ctx, acct.ID, "ffpc", at); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := store.Refusals(ctx, acct.ID, "ffpc", now.Add(-time.Hour)); err != nil || n != 2 {
		t.Fatalf("%d refusals in the hour: %v", n, err)
	}
}

// Two waiters take slots a gap apart, wherever they run.
func TestGatePacesAcrossCallers(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	g := &Gate{Pool: pool, Host: "ffpc", Gap: 200 * time.Millisecond, MaxWait: time.Second}
	other := &Gate{Pool: pool, Host: "ffpc", Gap: 200 * time.Millisecond, MaxWait: time.Second}
	start := time.Now()
	for _, gate := range []*Gate{g, other, g} {
		if err := gate.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if took := time.Since(start); took < 350*time.Millisecond {
		t.Fatalf("three requests in %v", took)
	}
	tight := &Gate{Pool: pool, Host: "ffpc", Gap: time.Second, MaxWait: 0}
	_ = tight.Wait(ctx)
	before := nextAt(t, g)
	if err := tight.Wait(ctx); err != ErrBusy {
		t.Fatalf("a turn past the wait: %v", err)
	}
	if after := nextAt(t, g); !after.Equal(before) {
		t.Fatalf("a refused request moved the gate from %v to %v", before, after)
	}
}

func nextAt(t *testing.T, g *Gate) time.Time {
	t.Helper()
	var at time.Time
	if err := g.Pool.QueryRow(context.Background(), `select next_at from app.host_request_gate where host = $1`, g.Host).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

// Concurrent takers, as from several processes, never share a slot: every
// slot taken is a full gap from every other.
func TestGateNeverDoubleBooks(t *testing.T) {
	pool := dbtest.Pool(t)
	const takers = 12
	gap := 50 * time.Millisecond
	slots := make(chan time.Time, takers)
	var wg sync.WaitGroup
	for range takers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			g := &Gate{Pool: pool, Host: "ffpc", Gap: gap, MaxWait: time.Minute}
			slot, _, err := g.take(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			slots <- slot
		}()
	}
	wg.Wait()
	close(slots)
	var got []time.Time
	for s := range slots {
		got = append(got, s)
	}
	sort.Slice(got, func(i, j int) bool { return got[i].Before(got[j]) })
	if len(got) != takers {
		t.Fatalf("%d of %d took a slot", len(got), takers)
	}
	for i := 1; i < len(got); i++ {
		if d := got[i].Sub(got[i-1]); d < gap {
			t.Fatalf("slots %d and %d are %v apart", i-1, i, d)
		}
	}
}

// Keeping a session from a read that began before a re-encrypt leaves the
// row on the new key version, and it still opens there alone.
func TestKeptSessionNeverUndoesARekey(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	acct, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_keep", Email: "keep@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	k1, k2 := key(t), key(t)
	v1, _ := NewVault(OneKey(k1))
	sealed, _ := v1.Seal(acct.ID.String(), "ffpc", Session{"c": "1"}, SignIn{Username: testUser, Password: testPass})
	store := &Store{Pool: pool}
	if _, err := store.Put(ctx, acct.ID, "ffpc", sealed, time.Now()); err != nil {
		t.Fatal(err)
	}
	stale, _ := store.Get(ctx, acct.ID, "ffpc")
	rotating, _ := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2, 1: k1}})
	if _, _, err := Rekey(ctx, store, rotating); err != nil {
		t.Fatal(err)
	}
	// The read that began before the job keeps its new cookies now.
	kept, err := rotating.Reseal(acct.ID.String(), "ffpc", stale.Sealed, Session{"c": "2"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SessionKept(ctx, acct.ID, "ffpc", kept.SessionCT); err != nil {
		t.Fatal(err)
	}
	row, _ := store.Get(ctx, acct.ID, "ffpc")
	v2, _ := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2}})
	s, err := v2.OpenSession(acct.ID.String(), "ffpc", row.Sealed)
	if row.Sealed.KeyVersion != 2 || err != nil || s["c"] != "2" {
		t.Fatalf("row at version %d, session %v, %v", row.Sealed.KeyVersion, s, err)
	}
}
