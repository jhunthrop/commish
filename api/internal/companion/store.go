package companion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db"
)

// ErrNotFound is a companion that is not the account's.
var ErrNotFound = errors.New("companion: not found")

// Row is one app.companions row.
type Row struct {
	ID           uuid.UUID
	AccountID    uuid.UUID
	Host         string
	HostDraftID  string
	HostLeagueID string
	Replay       bool
	Seat         int
	// HostUsername is the Sleeper username the seat was found by, empty
	// when the drafter chose a slot.
	HostUsername string
	Settings     apitypes.LeagueSettings
	Status       string
	LastHostPick int
	CreatedAt    time.Time
	FinishedAt   *time.Time
}

// Store is every read and write of app.companions and its cards.
type Store struct{ Pool *pgxpool.Pool }

const rowColumns = `id, account_id, host, host_draft_id, coalesce(host_league_id, ''), replay, seat,
	coalesce(host_username, ''), settings, status, last_host_pick, created_at, finished_at`

func scanRow(row pgx.Row) (Row, error) {
	var r Row
	var settings []byte
	err := row.Scan(&r.ID, &r.AccountID, &r.Host, &r.HostDraftID, &r.HostLeagueID, &r.Replay, &r.Seat, &r.HostUsername, &settings,
		&r.Status, &r.LastHostPick, &r.CreatedAt, &r.FinishedAt)
	if err != nil {
		return Row{}, err
	}
	if err := json.Unmarshal(settings, &r.Settings); err != nil {
		return Row{}, fmt.Errorf("companion: decode settings of %s: %w", r.ID, err)
	}
	return r, nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Upsert makes the account's companion for a host draft, or takes the
// one already made with the seat and settings the drafter chose now. The
// stored report stays unless the seat changed; a replay starts over each
// time it is made.
func (s *Store) Upsert(ctx context.Context, r Row) (Row, error) {
	settings, err := json.Marshal(r.Settings)
	if err != nil {
		return Row{}, fmt.Errorf("companion: encode settings: %w", err)
	}
	out, err := scanRow(s.Pool.QueryRow(ctx, `
		insert into app.companions (account_id, host, host_draft_id, host_league_id, replay, seat, settings, status, last_host_pick, host_username)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		on conflict (account_id, host, host_draft_id, replay) do update set
		  seat = excluded.seat, settings = excluded.settings, host_league_id = excluded.host_league_id,
		  host_username = excluded.host_username,
		  status = excluded.status, last_host_pick = excluded.last_host_pick,
		  report = case when excluded.replay or app.companions.seat <> excluded.seat then null else app.companions.report end,
		  created_at = case when excluded.replay then now() else app.companions.created_at end,
		  finished_at = null
		returning `+rowColumns,
		r.AccountID, r.Host, r.HostDraftID, nullable(r.HostLeagueID), r.Replay, r.Seat, settings, r.Status, r.LastHostPick,
		nullable(r.HostUsername)))
	if err != nil {
		return Row{}, fmt.Errorf("companion: upsert %s: %w", r.HostDraftID, err)
	}
	if !r.Replay {
		return out, nil
	}
	if _, err := s.Pool.Exec(ctx, `delete from app.companion_cards where companion_id = $1`, out.ID); err != nil {
		return Row{}, fmt.Errorf("companion: clear cards of %s: %w", out.ID, err)
	}
	return out, nil
}

// Get is one of the account's companions.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (Row, error) {
	r, err := scanRow(s.Pool.QueryRow(ctx, `select `+rowColumns+` from app.companions where id = $1 and account_id = $2`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Row{}, ErrNotFound
	}
	if err != nil {
		return Row{}, fmt.Errorf("companion: get %s: %w", id, err)
	}
	return r, nil
}

// Progress records how far the host had got, only when it moved, and
// when the host said the draft was over.
func (s *Store) Progress(ctx context.Context, id uuid.UUID, status string, lastPick int, finished bool) error {
	if _, err := s.Pool.Exec(ctx, `
		update app.companions set status = $2, last_host_pick = $3,
		  finished_at = case when $4 then coalesce(finished_at, now()) else null end
		where id = $1 and (status <> $2 or last_host_pick <> $3 or (finished_at is null) = $4)`,
		id, status, lastPick, finished); err != nil {
		return fmt.Errorf("companion: progress %s: %w", id, err)
	}
	return nil
}

// Card is the card stored for a pick, false when none is.
func (s *Store) Card(ctx context.Context, id uuid.UUID, pick int) (json.RawMessage, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select card from app.companion_cards where companion_id = $1 and pick_no = $2`, id, pick).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("companion: card %s at %d: %w", id, pick, err)
	}
	return raw, true, nil
}

// PutCard stores a pick's card; the first one written stands.
func (s *Store) PutCard(ctx context.Context, id uuid.UUID, pick int, card any) error {
	raw, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("companion: encode card: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `insert into app.companion_cards (companion_id, pick_no, card) values ($1, $2, $3)
		on conflict (companion_id, pick_no) do nothing`, id, pick, raw); err != nil {
		return fmt.Errorf("companion: put card %s at %d: %w", id, pick, err)
	}
	return nil
}

// Cards is every card stored for the companion, by pick.
func (s *Store) Cards(ctx context.Context, id uuid.UUID) (map[int]json.RawMessage, error) {
	rows, err := s.Pool.Query(ctx, `select pick_no, card from app.companion_cards where companion_id = $1`, id)
	if err != nil {
		return nil, fmt.Errorf("companion: cards of %s: %w", id, err)
	}
	out := map[int]json.RawMessage{}
	for rows.Next() {
		var pick int
		var raw []byte
		if err := rows.Scan(&pick, &raw); err != nil {
			rows.Close()
			return nil, fmt.Errorf("companion: cards of %s: %w", id, err)
		}
		out[pick] = raw
	}
	return out, rows.Err()
}

// Report is the stored report, false when none is.
func (s *Store) Report(ctx context.Context, id uuid.UUID) (json.RawMessage, bool, error) {
	var raw []byte
	if err := s.Pool.QueryRow(ctx, `select report from app.companions where id = $1`, id).Scan(&raw); err != nil {
		return nil, false, fmt.Errorf("companion: report %s: %w", id, err)
	}
	return raw, raw != nil, nil
}

// PutReport stores the finished draft's report.
func (s *Store) PutReport(ctx context.Context, id uuid.UUID, report any) error {
	raw, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("companion: encode report: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `update app.companions set report = $2 where id = $1`, id, raw); err != nil {
		return fmt.Errorf("companion: put report %s: %w", id, err)
	}
	return nil
}

// WithReportLock runs fn holding the companion's report lock, so
// parallel reads never build one report twice, on any instance.
func (s *Store) WithReportLock(ctx context.Context, id uuid.UUID, fn func(context.Context) error) error {
	return db.WithLock(ctx, s.Pool, "companion-report:"+id.String(), fn)
}

// Recent is the account's newest companions, newest first.
func (s *Store) Recent(ctx context.Context, accountID uuid.UUID, limit int) ([]Row, error) {
	rows, err := s.Pool.Query(ctx, `select `+rowColumns+` from app.companions where account_id = $1
		order by created_at desc limit $2`, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("companion: recent of %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) { return scanRow(r) })
	if err != nil {
		return nil, fmt.Errorf("companion: recent of %s: %w", accountID, err)
	}
	return out, nil
}
