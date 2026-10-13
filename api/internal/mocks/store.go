// Package mocks persists solo mocks: the settings, the seed and the
// action log a mock replays from (docs/design/2026-10-12-mock-room-rethink.md,
// "the mock is a function"), the card recorded at each turn, and the
// cached report. The solo room (internal/solo) drives it; this package
// also serves the account's list of mocks and deletes one.
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

// NewMock is a mock about to be saved with the start of its log.
type NewMock struct {
	ID       uuid.UUID
	LeagueID *uuid.UUID
	Settings apitypes.LeagueSettings
	Seed     int64
	// CreatedAt is the instant START_DRAFT is stamped with, the draft's
	// kickoff in its engine config; whole milliseconds, so it reads back
	// exactly.
	CreatedAt time.Time
	Actions   []Action
}

// Start saves a new mock and its first actions in one transaction: a
// mock never exists without the log that starts it.
func (s *Store) Start(ctx context.Context, accountID uuid.UUID, n NewMock) (apitypes.Mock, error) {
	raw, err := json.Marshal(leagues.Normalize(n.Settings))
	if err != nil {
		return apitypes.Mock{}, fmt.Errorf("mocks: encode settings: %w", err)
	}
	var m apitypes.Mock
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var err error
		m, err = scan(tx.QueryRow(ctx, `insert into app.mocks (id, account_id, league_id, settings, seed, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $6) returning `+columns, n.ID, accountID, n.LeagueID, raw, n.Seed, n.CreatedAt))
		if err != nil {
			return err
		}
		return copyActions(ctx, tx, n.ID, 0, n.Actions)
	})
	if err != nil {
		return apitypes.Mock{}, fmt.Errorf("mocks: start for %s: %w", accountID, err)
	}
	return m, nil
}

func copyActions(ctx context.Context, tx pgx.Tx, id uuid.UUID, afterSeq int64, actions []Action) error {
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"app", "mock_actions"}, []string{"mock_id", "seq", "kind", "payload", "at"},
		pgx.CopyFromSlice(len(actions), func(i int) ([]any, error) {
			a := actions[i]
			return []any{id, afterSeq + int64(i) + 1, a.Kind, a.Payload, a.At}, nil
		}))
	return err
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
// all, and completedAt, when the batch ends the draft, closes the mock in
// the same commit. afterSeq must be the log's current head, so two
// writers racing on one mock cannot interleave: the loser gets
// ErrSeqConflict.
func (s *Store) AppendActions(ctx context.Context, accountID, id uuid.UUID, afterSeq int64, actions []Action, completedAt *time.Time) error {
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
		err = copyActions(ctx, tx, id, afterSeq, actions)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrSeqConflict
		}
		if err != nil {
			return err
		}
		if completedAt != nil {
			_, err = tx.Exec(ctx, `update app.mocks set status = 'complete', completed_at = $2 where id = $1`, id, *completedAt)
		} else {
			_, err = tx.Exec(ctx, `update app.mocks set updated_at = now() where id = $1`, id)
		}
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrSeqConflict) {
		return fmt.Errorf("mocks: append %s: %w", id, err)
	}
	return err
}
