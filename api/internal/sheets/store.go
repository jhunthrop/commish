package sheets

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/headshots"
)

// Store errors.
var (
	ErrNotFound = errors.New("sheets: not found")
	ErrTooMany  = errors.New("sheets: too many sheets")
	ErrChanged  = errors.New("sheets: changed since read")
)

// Store reads and writes app.sheets and app.sheet_rows, every query
// scoped by account. Season names the copies a row's face is read as
// (headshots.Stored).
type Store struct {
	Pool   *pgxpool.Pool
	Season int
}

const sheetColumns = `s.id, s.name, s.format, (select count(*) from app.sheet_rows r where r.sheet_id = s.id), s.created_at, s.updated_at`

func scanSheet(row pgx.Row) (apitypes.Sheet, error) {
	var s apitypes.Sheet
	err := row.Scan(&s.Id, &s.Name, &s.Format, &s.RowCount, &s.CreatedAt, &s.UpdatedAt)
	return s, err
}

const rowColumns = `player_id, name, position, team, headshot, rank, tier, tags, note`

// scanRow reads one row; its face is our copy's address for the season,
// never a third party's (headshots.Stored).
func scanRow(row pgx.Row, season int) (apitypes.SheetRow, error) {
	var x apitypes.SheetRow
	err := row.Scan(&x.PlayerId, &x.Name, &x.Position, &x.Team, &x.Headshot, &x.Rank, &x.Tier, &x.Tags, &x.Note)
	x.Headshot = headshots.Stored(season, x.Headshot)
	if x.Tags == nil {
		x.Tags = apitypes.SheetTags{}
	}
	return x, err
}

// querier is a pool or a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// List is one page of the account's sheets and the total.
func (s *Store) List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.Sheet, int64, error) {
	var total int64
	if err := s.Pool.QueryRow(ctx, `select count(*) from app.sheets where account_id = $1`, accountID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("sheets: count %s: %w", accountID, err)
	}
	rows, err := s.Pool.Query(ctx, `select `+sheetColumns+` from app.sheets s where s.account_id = $1
		order by s.updated_at desc, s.id limit $2 offset $3`, accountID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("sheets: list %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.Sheet, error) { return scanSheet(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("sheets: list %s: %w", accountID, err)
	}
	return out, total, nil
}

func detail(ctx context.Context, q querier, accountID, id uuid.UUID, season int) (apitypes.SheetDetail, error) {
	s, err := scanSheet(q.QueryRow(ctx, `select `+sheetColumns+` from app.sheets s where s.id = $1 and s.account_id = $2`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return apitypes.SheetDetail{}, ErrNotFound
	}
	if err != nil {
		return apitypes.SheetDetail{}, err
	}
	rows, err := q.Query(ctx, `select `+rowColumns+`
		from app.sheet_rows where sheet_id = $1 order by rank`, id)
	if err != nil {
		return apitypes.SheetDetail{}, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.SheetRow, error) { return scanRow(r, season) })
	if err != nil {
		return apitypes.SheetDetail{}, err
	}
	return apitypes.SheetDetail{
		Id: s.Id, Name: s.Name, Format: s.Format, RowCount: s.RowCount,
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Rows: out,
	}, nil
}

// Get is one of the account's sheets with every row in rank order.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.SheetDetail, error) {
	d, err := detail(ctx, s.Pool, accountID, id, s.Season)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return d, fmt.Errorf("sheets: get %s: %w", id, err)
	}
	return d, err
}

// Create makes a sheet, with its rows when given, refusing past
// MaxPerAccount.
func (s *Store) Create(ctx context.Context, accountID uuid.UUID, in apitypes.SheetCreate) (apitypes.SheetDetail, error) {
	var out apitypes.SheetDetail
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('sheets:' || $1::text))`, accountID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.sheets where account_id = $1`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxPerAccount {
			return ErrTooMany
		}
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `insert into app.sheets (account_id, name, format) values ($1, $2, $3) returning id`,
			accountID, in.Name, string(in.Format)).Scan(&id); err != nil {
			return err
		}
		if in.Rows != nil {
			if err := insertRows(ctx, tx, id, *in.Rows); err != nil {
				return err
			}
		}
		d, err := detail(ctx, tx, accountID, id, s.Season)
		out = d
		return err
	})
	if err != nil && !errors.Is(err, ErrTooMany) {
		return out, fmt.Errorf("sheets: create for %s: %w", accountID, err)
	}
	return out, err
}

// Rename changes a sheet's name.
func (s *Store) Rename(ctx context.Context, accountID, id uuid.UUID, name string) (apitypes.Sheet, error) {
	tag, err := s.Pool.Exec(ctx, `update app.sheets set name = $3 where id = $1 and account_id = $2`, id, accountID, name)
	if err != nil {
		return apitypes.Sheet{}, fmt.Errorf("sheets: rename %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return apitypes.Sheet{}, ErrNotFound
	}
	sh, err := scanSheet(s.Pool.QueryRow(ctx, `select `+sheetColumns+` from app.sheets s where s.id = $1`, id))
	if err != nil {
		return apitypes.Sheet{}, fmt.Errorf("sheets: rename %s: %w", id, err)
	}
	return sh, nil
}

// Delete removes a sheet and its rows.
func (s *Store) Delete(ctx context.Context, accountID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `delete from app.sheets where id = $1 and account_id = $2`, id, accountID)
	if err != nil {
		return fmt.Errorf("sheets: delete %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// lockOwned locks one of the account's sheets for a row write and
// stamps it changed, setting its name too when name is given. With
// ifUpdatedAt it writes only when the sheet is as the writer last read
// it, and answers ErrChanged otherwise: the name and the rows pass the
// same guard in the same statement.
func lockOwned(ctx context.Context, tx pgx.Tx, accountID, id uuid.UUID, name *string, ifUpdatedAt *time.Time) error {
	tag, err := tx.Exec(ctx, `update app.sheets set updated_at = now(), name = coalesce($4, name)
		where id = $1 and account_id = $2 and ($3::timestamptz is null or updated_at = $3)`, id, accountID, ifUpdatedAt, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if ifUpdatedAt == nil {
		return ErrNotFound
	}
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from app.sheets where id = $1 and account_id = $2)`, id, accountID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrChanged
	}
	return ErrNotFound
}

func insertRows(ctx context.Context, tx pgx.Tx, sheetID uuid.UUID, rows []apitypes.SheetRowInput) error {
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"app", "sheet_rows"},
		[]string{"sheet_id", "player_id", "rank", "name", "position", "team", "headshot", "tier", "tags", "note"},
		pgx.CopyFromSlice(len(rows), func(i int) ([]any, error) {
			r := rows[i]
			return []any{sheetID, r.PlayerId, i + 1, r.Name, r.Position, r.Team, r.Headshot, r.Tier, normalizeTags(r.Tags), r.Note}, nil
		}))
	return err
}

// ReplaceRows replaces every row, ranked by order from 1, and the name
// when one is given. With ifUpdatedAt it refuses with ErrChanged when the
// sheet has changed since the writer read it.
func (s *Store) ReplaceRows(ctx context.Context, accountID, id uuid.UUID, rows []apitypes.SheetRowInput, name *string, ifUpdatedAt *time.Time) (apitypes.SheetDetail, error) {
	var out apitypes.SheetDetail
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lockOwned(ctx, tx, accountID, id, name, ifUpdatedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from app.sheet_rows where sheet_id = $1`, id); err != nil {
			return err
		}
		if err := insertRows(ctx, tx, id, rows); err != nil {
			return err
		}
		d, err := detail(ctx, tx, accountID, id, s.Season)
		out = d
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrChanged) {
		return out, fmt.Errorf("sheets: replace rows %s: %w", id, err)
	}
	return out, err
}

// UpdateRow sets one row's tier, tags and note.
func (s *Store) UpdateRow(ctx context.Context, accountID, id uuid.UUID, playerID string, in apitypes.SheetRowUpdate) (apitypes.SheetRow, error) {
	var out apitypes.SheetRow
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lockOwned(ctx, tx, accountID, id, nil, nil); err != nil {
			return err
		}
		row, err := scanRow(tx.QueryRow(ctx, `update app.sheet_rows set tier = $3, tags = $4, note = $5
			where sheet_id = $1 and player_id = $2
			returning `+rowColumns, id, playerID, in.Tier, normalizeTags(&in.Tags), in.Note), s.Season)
		out = row
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) {
		return out, fmt.Errorf("sheets: update row %s %s: %w", id, playerID, err)
	}
	return out, err
}
