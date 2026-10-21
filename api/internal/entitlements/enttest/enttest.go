// Package enttest writes entitlements for database-backed tests that ask
// the gates at a fixed clock (Lane 124).
//
// A row's starts_at is the database's now(), and a test's clock is often
// days before it (the replay clock, 2026-10-13), so the row would count as
// started only by liveClause's statement_timestamp() term. A database
// clock stepped back between the write and the read (the Colima VM's runs
// ahead of the host and is corrected now and then) then reads the pass as
// not yet started, and the gate answers 403. Starting the row at the clock
// the gate is asked at makes it live by the API's clock alone.
package enttest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// GrantFrom writes a hand grant of product, live from from until endsAt.
func GrantFrom(t *testing.T, store *entitlements.Store, accountID uuid.UUID, product entitlements.Product, season int, from, endsAt time.Time) {
	t.Helper()
	if err := store.Grant(context.Background(), accountID, product, season, endsAt, "test"); err != nil {
		t.Fatal(err)
	}
	StartAt(t, store, accountID, from)
}

// StartAt starts every entitlement the account holds at from.
func StartAt(t *testing.T, store *entitlements.Store, accountID uuid.UUID, from time.Time) {
	t.Helper()
	tag, err := store.Pool.Exec(context.Background(),
		`update app.entitlements set starts_at = $2 where account_id = $1`, accountID, from)
	if err != nil || tag.RowsAffected() == 0 {
		t.Fatalf("start %s's entitlements at %v: %d rows, %v", accountID, from, tag.RowsAffected(), err)
	}
}
