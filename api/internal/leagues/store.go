package leagues

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// ErrNotFound is a league that does not exist or is someone else's.
var ErrNotFound = errors.New("leagues: not found")

// MaxPerAccount bounds how many leagues one account saves.
const MaxPerAccount = 50

// ErrTooMany is a save past MaxPerAccount.
var ErrTooMany = errors.New("leagues: too many saved")

// Store reads and writes app.leagues. Every query is scoped by account,
// so one drafter can never read or change another's league.
type Store struct{ Pool *pgxpool.Pool }

const columns = `id, name, settings, created_at, updated_at`

func scan(row pgx.Row) (apitypes.League, error) {
	var l apitypes.League
	var raw []byte
	if err := row.Scan(&l.Id, &l.Name, &raw, &l.CreatedAt, &l.UpdatedAt); err != nil {
		return apitypes.League{}, err
	}
	if err := json.Unmarshal(raw, &l.Settings); err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: decode settings %s: %w", l.Id, err)
	}
	l.Settings = Normalize(l.Settings)
	l.Rounds = Rounds(l.Settings)
	return l, nil
}

// Normalize gives a settings value its canonical empty forms, so the
// answer always carries keepers as a list.
func Normalize(s apitypes.LeagueSettings) apitypes.LeagueSettings {
	if s.Keepers == nil {
		s.Keepers = []apitypes.Keeper{}
	}
	return s
}

// List is one page of the account's leagues, most recently changed
// first, and the total.
func (s *Store) List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.League, int64, error) {
	var total int64
	if err := s.Pool.QueryRow(ctx, `select count(*) from app.leagues where account_id = $1`, accountID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("leagues: count %s: %w", accountID, err)
	}
	rows, err := s.Pool.Query(ctx, `select `+columns+` from app.leagues where account_id = $1
		order by updated_at desc, id limit $2 offset $3`, accountID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("leagues: list %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.League, error) { return scan(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("leagues: list %s: %w", accountID, err)
	}
	return out, total, nil
}

// Get reads one of the account's leagues.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.League, error) {
	l, err := scan(s.Pool.QueryRow(ctx,
		`select `+columns+` from app.leagues where id = $1 and account_id = $2`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return apitypes.League{}, ErrNotFound
	}
	if err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: get %s: %w", id, err)
	}
	return l, nil
}

// Create saves a new league, refusing past MaxPerAccount.
func (s *Store) Create(ctx context.Context, accountID uuid.UUID, in apitypes.LeagueInput) (apitypes.League, error) {
	raw, err := json.Marshal(Normalize(in.Settings))
	if err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: encode settings: %w", err)
	}
	var out apitypes.League
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		// Serialize this account's creates so the cap cannot be raced.
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('leagues:' || $1::text))`, accountID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.leagues where account_id = $1`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxPerAccount {
			return ErrTooMany
		}
		l, err := scan(tx.QueryRow(ctx, `insert into app.leagues (account_id, name, settings) values ($1, $2, $3)
			returning `+columns, accountID, in.Name, raw))
		out = l
		return err
	})
	if errors.Is(err, ErrTooMany) {
		return apitypes.League{}, err
	}
	if err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: create for %s: %w", accountID, err)
	}
	return out, nil
}

// Replace overwrites one of the account's leagues.
func (s *Store) Replace(ctx context.Context, accountID, id uuid.UUID, in apitypes.LeagueInput) (apitypes.League, error) {
	raw, err := json.Marshal(Normalize(in.Settings))
	if err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: encode settings: %w", err)
	}
	l, err := scan(s.Pool.QueryRow(ctx, `update app.leagues set name = $3, settings = $4
		where id = $1 and account_id = $2 returning `+columns, id, accountID, in.Name, raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return apitypes.League{}, ErrNotFound
	}
	if err != nil {
		return apitypes.League{}, fmt.Errorf("leagues: replace %s: %w", id, err)
	}
	return l, nil
}

// Delete removes one of the account's leagues. Mocks saved from it keep
// their own copy of the settings.
func (s *Store) Delete(ctx context.Context, accountID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `delete from app.leagues where id = $1 and account_id = $2`, id, accountID)
	if err != nil {
		return fmt.Errorf("leagues: delete %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
