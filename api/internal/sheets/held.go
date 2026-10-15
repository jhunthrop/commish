package sheets

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// HoldTag is the tag that marks a player the drafter means to keep: the
// in-season tools never offer him as a drop or a trade give (spec
// 2026-10-15 §5.2). It is a drafter's own word, read in any case.
const HoldTag = "hold"

// maxHeld bounds the read: every row of every sheet an account may keep.
const maxHeld = MaxRows * MaxPerAccount

// Held is every player id the account tags Hold on any of its sheets.
func (s *Store) Held(ctx context.Context, accountID uuid.UUID) (map[string]bool, error) {
	rows, err := s.Pool.Query(ctx, `select distinct r.player_id from app.sheet_rows r
		join app.sheets s on s.id = r.sheet_id
		where s.account_id = $1 and exists (select 1 from unnest(r.tags) t where lower(t) = $2)
		order by r.player_id limit $3`, accountID, HoldTag, maxHeld)
	if err != nil {
		return nil, fmt.Errorf("sheets: held for %s: %w", accountID, err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sheets: held for %s: %w", accountID, err)
		}
		out[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sheets: held for %s: %w", accountID, err)
	}
	return out, nil
}
