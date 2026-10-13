// Package mocks persists solo mocks: the settings, the seed and the
// action log a mock replays from (docs/design/2026-10-12-mock-room-rethink.md,
// "the mock is a function"). The engine lane drives picks through
// AppendActions; this package owns the shape and the HTTP surface for
// creating, reading and deleting a mock.
package mocks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// Store errors.
var (
	ErrNotFound    = errors.New("mocks: not found")
	ErrSeqConflict = errors.New("mocks: the log moved on")
)

// Store reads and writes app.mocks and app.mock_actions, every query
// scoped by account.
type Store struct{ Pool *pgxpool.Pool }

const columns = `id, league_id, settings, seed, status, created_at, updated_at, completed_at`

func scan(row pgx.Row) (apitypes.Mock, error) {
	var m apitypes.Mock
	var raw []byte
	if err := row.Scan(&m.Id, &m.LeagueId, &raw, &m.Seed, &m.Status, &m.CreatedAt, &m.UpdatedAt, &m.CompletedAt); err != nil {
		return apitypes.Mock{}, err
	}
	if err := json.Unmarshal(raw, &m.Settings); err != nil {
		return apitypes.Mock{}, fmt.Errorf("mocks: decode settings %s: %w", m.Id, err)
	}
	m.Settings = leagues.Normalize(m.Settings)
	return m, nil
}

// Create saves a new mock.
func (s *Store) Create(ctx context.Context, accountID uuid.UUID, leagueID *uuid.UUID, settings apitypes.LeagueSettings, seed int64) (apitypes.Mock, error) {
	raw, err := json.Marshal(leagues.Normalize(settings))
	if err != nil {
		return apitypes.Mock{}, fmt.Errorf("mocks: encode settings: %w", err)
	}
	m, err := scan(s.Pool.QueryRow(ctx, `insert into app.mocks (account_id, league_id, settings, seed)
		values ($1, $2, $3, $4) returning `+columns, accountID, leagueID, raw, seed))
	if err != nil {
		return apitypes.Mock{}, fmt.Errorf("mocks: create for %s: %w", accountID, err)
	}
	return m, nil
}

// List is one page of the account's mocks, newest first, and the total.
func (s *Store) List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.Mock, int64, error) {
	var total int64
	if err := s.Pool.QueryRow(ctx, `select count(*) from app.mocks where account_id = $1`, accountID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("mocks: count %s: %w", accountID, err)
	}
	rows, err := s.Pool.Query(ctx, `select `+columns+` from app.mocks where account_id = $1
		order by created_at desc, id limit $2 offset $3`, accountID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("mocks: list %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.Mock, error) { return scan(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("mocks: list %s: %w", accountID, err)
	}
	return out, total, nil
}

// Get reads one of the account's mocks with its whole log.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.MockDetail, error) {
	m, err := scan(s.Pool.QueryRow(ctx, `select `+columns+` from app.mocks where id = $1 and account_id = $2`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return apitypes.MockDetail{}, ErrNotFound
	}
	if err != nil {
		return apitypes.MockDetail{}, fmt.Errorf("mocks: get %s: %w", id, err)
	}
	rows, err := s.Pool.Query(ctx, `select seq, kind, payload, at from app.mock_actions where mock_id = $1 order by seq`, id)
	if err != nil {
		return apitypes.MockDetail{}, fmt.Errorf("mocks: actions %s: %w", id, err)
	}
	actions, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.MockAction, error) {
		var a apitypes.MockAction
		err := r.Scan(&a.Seq, &a.Kind, &a.Payload, &a.At)
		return a, err
	})
	if err != nil {
		return apitypes.MockDetail{}, fmt.Errorf("mocks: actions %s: %w", id, err)
	}
	return apitypes.MockDetail{
		Id: m.Id, LeagueId: m.LeagueId, Settings: m.Settings, Seed: m.Seed, Status: m.Status,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, CompletedAt: m.CompletedAt, Actions: actions,
	}, nil
}

// Delete removes one of the account's mocks and its log.
func (s *Store) Delete(ctx context.Context, accountID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `delete from app.mocks where id = $1 and account_id = $2`, id, accountID)
	if err != nil {
		return fmt.Errorf("mocks: delete %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Action is one entry for the log.
type Action struct {
	Kind    string
	Payload map[string]any
	At      time.Time
}

// AppendActions writes actions after afterSeq in one transaction: a
// human pick and every bot pick it resolves land together or not at
// all. afterSeq must be the log's current head, so two writers racing
// on one mock cannot interleave: the loser gets ErrSeqConflict.
func (s *Store) AppendActions(ctx context.Context, accountID, id uuid.UUID, afterSeq int64, actions []Action) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var head int64
		err := tx.QueryRow(ctx, `
			select coalesce((select max(seq) from app.mock_actions where mock_id = m.id), 0)
			from app.mocks m where m.id = $1 and m.account_id = $2 and m.status = 'active' for update`,
			id, accountID).Scan(&head)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if head != afterSeq {
			return ErrSeqConflict
		}
		_, err = tx.CopyFrom(ctx, pgx.Identifier{"app", "mock_actions"}, []string{"mock_id", "seq", "kind", "payload", "at"},
			pgx.CopyFromSlice(len(actions), func(i int) ([]any, error) {
				a := actions[i]
				return []any{id, afterSeq + int64(i) + 1, a.Kind, a.Payload, a.At}, nil
			}))
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrSeqConflict
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update app.mocks set updated_at = now() where id = $1`, id)
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrSeqConflict) {
		return fmt.Errorf("mocks: append %s: %w", id, err)
	}
	return err
}

// Complete marks a mock finished.
func (s *Store) Complete(ctx context.Context, accountID, id uuid.UUID, at time.Time) error {
	tag, err := s.Pool.Exec(ctx, `update app.mocks set status = 'complete', completed_at = $3
		where id = $1 and account_id = $2 and status = 'active'`, id, accountID, at)
	if err != nil {
		return fmt.Errorf("mocks: complete %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
