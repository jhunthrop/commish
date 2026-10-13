package hosts

import (
	"context"
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
	if err := tight.Wait(ctx); err != ErrBusy {
		t.Fatalf("a turn past the wait: %v", err)
	}
}
