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
	// Branch counts the undos: a card belongs to the branch it was
	// computed on.
	Branch int
}

const logColumns = columns + `, branch`

// ReadLog reads one of the owner's mocks and its whole log.
func (s *Store) ReadLog(ctx context.Context, owner Owner, id uuid.UUID) (Log, error) {
	match, arg := owner.match(2)
	var out Log
	var raw []byte
	m := &out.Mock
	err := s.Pool.QueryRow(ctx, `select `+logColumns+` from app.mocks m where m.id = $1 and `+match, id, arg).
		Scan(&m.Id, &m.LeagueId, &raw, &m.Seed, &m.Status, &m.CreatedAt, &m.UpdatedAt, &m.CompletedAt, &out.Branch)
	if errors.Is(err, pgx.ErrNoRows) {
		return Log{}, ErrNotFound
	}
	if err != nil {
		return Log{}, fmt.Errorf("mocks: read %s: %w", id, err)
	}
	if err := decodeSettings(raw, m); err != nil {
		return Log{}, err
	}
	rows, err := s.Pool.Query(ctx, `select seq, payload from app.mock_actions where mock_id = $1 order by seq`, id)
	if err != nil {
		return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
	}
	for rows.Next() {
		var seq int64
		var payload []byte
		if err := rows.Scan(&seq, &payload); err != nil {
			rows.Close()
			return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
		}
		if seq != out.Head+1 {
			rows.Close()
			return Log{}, fmt.Errorf("mocks: log %s skips from %d to %d", id, out.Head, seq)
		}
		out.Payloads = append(out.Payloads, payload)
		out.Head = seq
	}
	if err := rows.Err(); err != nil {
		return Log{}, fmt.Errorf("mocks: log %s: %w", id, err)
	}
	return out, nil
}

// Truncate takes back every action from seq fromSeq on, starts a new
// branch and reopens the mock: the undo. The cached report goes with the
// branch it belonged to. head is the log's head the caller read, so a
// racing writer cannot be undone under.
func (s *Store) Truncate(ctx context.Context, owner Owner, id uuid.UUID, head, fromSeq int64) error {
	match, arg := owner.match(2)
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var current int64
		err := tx.QueryRow(ctx, `
			select coalesce((select max(seq) from app.mock_actions where mock_id = m.id), 0)
			from app.mocks m where m.id = $1 and `+match+` for update`, id, arg).Scan(&current)
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
		_, err = tx.Exec(ctx, `update app.mocks set status = 'active', completed_at = null, report = null, report_at = null,
			branch = branch + 1 where id = $1`, id)
		return err
	})
	if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrSeqConflict) {
		return fmt.Errorf("mocks: truncate %s: %w", id, err)
	}
	return err
}

// Card is the card stored for a pick on a branch, false when none is.
// The caller has read the mock under its owner first.
func (s *Store) Card(ctx context.Context, id uuid.UUID, branch, pick int) (json.RawMessage, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select card from app.mock_cards where mock_id = $1 and branch = $2 and pick_no = $3`,
		id, branch, pick).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("mocks: card %s at %d: %w", id, pick, err)
	}
	return raw, true, nil
}

// PutCard stores a pick's card on the branch it was computed on, and
// only while that branch is the mock's: a card that lands after an undo
// it raced is dropped. The first card written stands, so two tabs asking
// at once record the same card.
func (s *Store) PutCard(ctx context.Context, id uuid.UUID, branch, pick int, card any) error {
	raw, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("mocks: encode card: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `insert into app.mock_cards (mock_id, branch, pick_no, card)
		select $1, $2, $3, $4 where exists (select 1 from app.mocks where id = $1 and branch = $2)
		on conflict (mock_id, branch, pick_no) do nothing`, id, branch, pick, raw); err != nil {
		return fmt.Errorf("mocks: put card %s at %d: %w", id, pick, err)
	}
	return nil
}

// Report is the cached report, false when none is.
func (s *Store) Report(ctx context.Context, owner Owner, id uuid.UUID) (json.RawMessage, bool, error) {
	match, arg := owner.match(2)
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select m.report from app.mocks m where m.id = $1 and `+match+` and m.report is not null`, id, arg).Scan(&raw)
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
func (s *Store) PutReport(ctx context.Context, owner Owner, id uuid.UUID, head int64, report any, at time.Time) error {
	raw, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("mocks: encode report: %w", err)
	}
	match, arg := owner.match(2)
	_, err = s.Pool.Exec(ctx, `update app.mocks m set report = $4, report_at = $5
		where m.id = $1 and `+match+` and m.status = 'complete'
		and coalesce((select max(seq) from app.mock_actions where mock_id = m.id), 0) = $3`, id, arg, head, raw, at)
	if err != nil {
		return fmt.Errorf("mocks: put report %s: %w", id, err)
	}
	return nil
}
