package leaguesync

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// grantFrom writes a hand grant of product, live from the service's clock
// until endsAt (Lane 124). A grant's starts_at is the database's now(),
// days after the replay clock (2026-10-13) the gates ask at, so the row
// would count as started only by liveClause's statement_timestamp() term:
// a database clock stepped back between the insert and the gate's read
// (the Colima VM's runs ahead of the host and is corrected now and then)
// reads the pass as not yet started, and the gate answers 403 naming the
// Draft Pass. Starting the grant at the clock the gate is asked at makes
// it live by the API's clock alone.
func grantFrom(t *testing.T, pool *pgxpool.Pool, accountID uuid.UUID, product entitlements.Product, season int, from, endsAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if err := (&entitlements.Store{Pool: pool}).Grant(ctx, accountID, product, season, endsAt, "test"); err != nil {
		t.Fatal(err)
	}
	tag, err := pool.Exec(ctx, `update app.entitlements set starts_at = $2 where account_id = $1 and product = $3 and granted_by = 'test'`,
		accountID, from, string(product))
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("start the %s grant at %v: %d rows, %v", product, from, tag.RowsAffected(), err)
	}
}
