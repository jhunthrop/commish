package yahoo

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// A state finishes once, for the account that started it, within ten
// minutes; the table keeps only its hash.
func TestStatesFinishOnceWithinTheirTime(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	acct, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_yahoo_state", Email: "state@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	states := &States{Pool: pool}
	now := time.Now()
	state, _ := NewState()
	verifier, _, _ := NewVerifier()
	if err := states.Start(ctx, acct.ID, state, verifier, now); err != nil {
		t.Fatal(err)
	}
	var kept int
	if err := pool.QueryRow(ctx, `select count(*) from app.host_oauth_states where state_hash = $1::bytea`, []byte(state)).Scan(&kept); err != nil || kept != 0 {
		t.Fatalf("the state itself is kept: %d, %v", kept, err)
	}
	if _, _, err := states.Finish(ctx, state, now.Add(StateTTL+time.Second)); !errors.Is(err, ErrNoState) {
		t.Fatalf("past ten minutes: %v", err)
	}
	id, v, err := states.Finish(ctx, state, now.Add(time.Minute))
	if err != nil || id != acct.ID || v != verifier {
		t.Fatalf("finish: %v %v", id, err)
	}
	if _, _, err := states.Finish(ctx, state, now.Add(time.Minute)); !errors.Is(err, ErrNoState) {
		t.Fatalf("a second finish: %v", err)
	}
	// A later start drops what has expired.
	old, _ := NewState()
	if err := states.Start(ctx, acct.ID, old, verifier, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	fresh, _ := NewState()
	if err := states.Start(ctx, acct.ID, fresh, verifier, now); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `select count(*) from app.host_oauth_states`).Scan(&kept); err != nil || kept != 1 {
		t.Fatalf("%d states kept after a start, want the fresh one", kept)
	}
}
