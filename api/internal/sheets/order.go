package sheets

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Order is the account's newest sheet as player ids in rank order, the
// order a room's autopick reads after the queue and before the board.
// Empty when the account has no sheet.
func (s *Store) Order(ctx context.Context, accountID uuid.UUID) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		select r.player_id from app.sheet_rows r
		where r.sheet_id = (select id from app.sheets where account_id = $1 order by updated_at desc, id limit 1)
		order by r.rank`, accountID)
	if err != nil {
		return nil, fmt.Errorf("sheets: order for %s: %w", accountID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("sheets: order for %s: %w", accountID, err)
	}
	return ids, nil
}
