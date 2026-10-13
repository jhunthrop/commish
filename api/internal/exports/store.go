package exports

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// ErrNotFound is an export that does not exist, is someone else's, or
// has expired.
var ErrNotFound = errors.New("exports: not found")

// Store reads and writes app.exports.
type Store struct{ Pool *pgxpool.Pool }

// Row is one export with its object key, which never leaves the API.
type Row struct {
	apitypes.Export
	AccountID uuid.UUID
	ObjectKey string
}

const columns = `id, account_id, sheet_id, format, object_key, file_name, bytes, created_at, expires_at`

func scan(row pgx.Row) (Row, error) {
	var x Row
	err := row.Scan(&x.Id, &x.AccountID, &x.SheetId, &x.Format, &x.ObjectKey, &x.FileName, &x.Bytes, &x.CreatedAt, &x.ExpiresAt)
	return x, err
}

// Insert records an export already written to the bucket.
func (s *Store) Insert(ctx context.Context, x Row) (Row, error) {
	out, err := scan(s.Pool.QueryRow(ctx, `
		insert into app.exports (id, account_id, sheet_id, format, object_key, file_name, bytes, expires_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8) returning `+columns,
		x.Id, x.AccountID, x.SheetId, string(x.Format), x.ObjectKey, x.FileName, x.Bytes, x.ExpiresAt))
	if err != nil {
		return Row{}, fmt.Errorf("exports: insert %s: %w", x.Id, err)
	}
	return out, nil
}

// Get reads one of the account's unexpired exports.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID, now time.Time) (Row, error) {
	x, err := scan(s.Pool.QueryRow(ctx, `select `+columns+` from app.exports
		where id = $1 and account_id = $2 and expires_at > $3`, id, accountID, now))
	if errors.Is(err, pgx.ErrNoRows) {
		return Row{}, ErrNotFound
	}
	if err != nil {
		return Row{}, fmt.Errorf("exports: get %s: %w", id, err)
	}
	return x, nil
}

// List is one page of the account's unexpired exports and the total.
func (s *Store) List(ctx context.Context, accountID uuid.UUID, now time.Time, limit, offset int) ([]apitypes.Export, int64, error) {
	var total int64
	if err := s.Pool.QueryRow(ctx, `select count(*) from app.exports where account_id = $1 and expires_at > $2`,
		accountID, now).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("exports: count %s: %w", accountID, err)
	}
	rows, err := s.Pool.Query(ctx, `select `+columns+` from app.exports
		where account_id = $1 and expires_at > $2 order by created_at desc, id limit $3 offset $4`,
		accountID, now, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("exports: list %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.Export, error) {
		x, err := scan(r)
		return x.Export, err
	})
	if err != nil {
		return nil, 0, fmt.Errorf("exports: list %s: %w", accountID, err)
	}
	return out, total, nil
}

// Expired lists up to limit exports past their expiry, for the sweep.
func (s *Store) Expired(ctx context.Context, now time.Time, limit int) ([]Row, error) {
	rows, err := s.Pool.Query(ctx, `select `+columns+` from app.exports where expires_at <= $1
		order by expires_at limit $2`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("exports: expired: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) { return scan(r) })
	if err != nil {
		return nil, fmt.Errorf("exports: expired: %w", err)
	}
	return out, nil
}

// Delete removes one export's row.
func (s *Store) Delete(ctx context.Context, id uuid.UUID) error {
	if _, err := s.Pool.Exec(ctx, `delete from app.exports where id = $1`, id); err != nil {
		return fmt.Errorf("exports: delete %s: %w", id, err)
	}
	return nil
}
