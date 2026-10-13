package mocks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Log is one mock with its action payloads in seq order, what the engine
// replays (mock.FromLog).
type Log struct {
	Mock     apitypes.Mock
	Payloads []json.RawMessage
	// Head is the last seq, 0 for an empty log.
	Head int64
}

// ReadLog reads one of the account's mocks and its whole log.
func (s *Store) ReadLog(ctx context.Context, accountID, id uuid.UUID) (Log, error) {
	m, err := scan(s.Pool.QueryRow(ctx, `select `+columns+` from app.mocks where id = $1 and account_id = $2`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Log{}, ErrNotFound
	}
	if err != nil {
		return Log{}, fmt.Errorf("mocks: read %s: %w", id, err)
	}
	rows, err := s.Pool.Query(ctx, `select seq, payload from app.mock_actions where mock_id = $1 order by seq`, id)
	if err != nil {
		return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
	}
	out := Log{Mock: m}
	for rows.Next() {
		var seq int64
		var raw []byte
		if err := rows.Scan(&seq, &raw); err != nil {
			rows.Close()
			return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
		}
		if seq != out.Head+1 {
			rows.Close()
			return Log{}, fmt.Errorf("mocks: log %s skips from %d to %d", id, out.Head, seq)
		}
		out.Payloads = append(out.Payloads, raw)
		out.Head = seq
	}
	if err := rows.Err(); err != nil {
		return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
	}
	return out, nil
}

// Truncate takes back every action from seq fromSeq on and reopens the
// mock: the undo. Cards past the pick it returns to and the cached report
// go with the branch they belonged to. afterSeq is the head the caller
// read, so a racing writer cannot be undone under.
func (s *Store) Truncate(ctx context.Context, accountID, id uuid.UUID, head, fromSeq int64, keepCardsThrough int) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var current int64
		err := tx.QueryRow(ctx, `
			select coalesce((select max(seq) from app.mock_actions where mock_id = m.id), 0)
			from app.mocks m where m.id = $1 and m.account_id = $2 for update`, id, accountID).Scan(&current)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if current != head {
			return ErrSeqConflict
		}
		if _, err := tx.Exec(ctx, `delete from app.mock_actions where mock_id = $1 and seq >= $2`, id, fromSeq); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from app.mock_cards where mock_id = $1 and pick_no > $2`, id, keepCardsThrough); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update app.mocks set status = 'active', completed_at = null, report = null, report_at = null where id = $1`, id)
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrSeqConflict) {
		return fmt.Errorf("mocks: truncate %s: %w", id, err)
	}
	return err
}

// Card is the card stored for a pick, false when none is.
func (s *Store) Card(ctx context.Context, id uuid.UUID, pick int) (json.RawMessage, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select card from app.mock_cards where mock_id = $1 and pick_no = $2`, id, pick).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("mocks: card %s at %d: %w", id, pick, err)
	}
	return raw, true, nil
}

// PutCard stores a pick's card; the first one written stands, so two tabs
// asking at once record the same card.
func (s *Store) PutCard(ctx context.Context, id uuid.UUID, pick int, card any) error {
	raw, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("mocks: encode card: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `insert into app.mock_cards (mock_id, pick_no, card) values ($1, $2, $3)
		on conflict (mock_id, pick_no) do nothing`, id, pick, raw); err != nil {
		return fmt.Errorf("mocks: put card %s at %d: %w", id, pick, err)
	}
	return nil
}

// Report is the cached report, false when none is.
func (s *Store) Report(ctx context.Context, accountID, id uuid.UUID) (json.RawMessage, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select report from app.mocks where id = $1 and account_id = $2 and report is not null`, id, accountID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("mocks: report %s: %w", id, err)
	}
	return raw, true, nil
}

// PutReport caches a finished mock's report at the head it was read at:
// an undo since then leaves nothing stale behind.
func (s *Store) PutReport(ctx context.Context, accountID, id uuid.UUID, head int64, report any, at time.Time) error {
	raw, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("mocks: encode report: %w", err)
	}
	_, err = s.Pool.Exec(ctx, `update app.mocks m set report = $4, report_at = $5
		where m.id = $1 and m.account_id = $2 and m.status = 'complete'
		and coalesce((select max(seq) from app.mock_actions where mock_id = m.id), 0) = $3`, id, accountID, head, raw, at)
	if err != nil {
		return fmt.Errorf("mocks: put report %s: %w", id, err)
	}
	return nil
}
