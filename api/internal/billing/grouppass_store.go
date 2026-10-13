package billing

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Claim is one claimed seat of a group pass: who holds it, by lobby
// handle, and when they claimed it.
type Claim struct {
	Handle    *string
	ClaimedAt time.Time
}

// GroupPassClaims reads every claim on the given group passes, first
// claim first, keyed by group pass. It reads app.entitlements without
// writing it: entitlements stays the only writer.
func (s *Store) GroupPassClaims(ctx context.Context, groupPassIDs []uuid.UUID) (map[uuid.UUID][]Claim, error) {
	out := map[uuid.UUID][]Claim{}
	if len(groupPassIDs) == 0 {
		return out, nil
	}
	rows, err := s.Pool.Query(ctx, `
		select e.group_pass_id, a.handle, e.created_at
		from app.entitlements e join app.accounts a on a.id = e.account_id
		where e.group_pass_id = any($1)
		order by e.created_at, e.id`, groupPassIDs)
	if err != nil {
		return nil, fmt.Errorf("billing: group pass claims: %w", err)
	}
	type claimRow struct {
		pass  uuid.UUID
		claim Claim
	}
	claims, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (claimRow, error) {
		var c claimRow
		err := r.Scan(&c.pass, &c.claim.Handle, &c.claim.ClaimedAt)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("billing: group pass claims: %w", err)
	}
	for _, c := range claims {
		out[c.pass] = append(out[c.pass], c.claim)
	}
	return out, nil
}
