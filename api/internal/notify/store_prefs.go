package notify

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// querier is a pool or a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Preferences is the account's push preferences, the defaults when it
// changed none.
func (s *Store) Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error) {
	return readPreferences(ctx, s.Pool, accountID, "")
}

// readPreferences reads the row, with lock appended to the select.
func readPreferences(ctx context.Context, q querier, accountID uuid.UUID, lock string) (Preferences, error) {
	p := DefaultPreferences()
	var off []string
	err := q.QueryRow(ctx, `select time_zone, quiet_start, quiet_end, kinds_off from app.notification_preferences
		where account_id = $1`+lock, accountID).Scan(&p.TimeZone, &p.QuietStart, &p.QuietEnd, &off)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return Preferences{}, fmt.Errorf("notify: preferences %s: %w", accountID, err)
	}
	for _, k := range off {
		p.Off = append(p.Off, Kind(k))
	}
	return p, nil
}

// PutPreferences writes the account's push preferences whole.
func (s *Store) PutPreferences(ctx context.Context, accountID uuid.UUID, p Preferences) error {
	return writePreferences(ctx, s.Pool, accountID, p)
}

func writePreferences(ctx context.Context, q querier, accountID uuid.UUID, p Preferences) error {
	off := make([]string, len(p.Off))
	for i, k := range p.Off {
		off[i] = string(k)
	}
	var written bool
	err := q.QueryRow(ctx, `insert into app.notification_preferences (account_id, time_zone, quiet_start, quiet_end, kinds_off)
		values ($1, $2, $3, $4, $5)
		on conflict (account_id) do update set time_zone = excluded.time_zone, quiet_start = excluded.quiet_start,
			quiet_end = excluded.quiet_end, kinds_off = excluded.kinds_off, updated_at = now()
		returning true`,
		accountID, p.TimeZone, p.QuietStart, p.QuietEnd, off).Scan(&written)
	if err != nil {
		return fmt.Errorf("notify: put preferences %s: %w", accountID, err)
	}
	return nil
}

// UpdatePreferences applies an update to the account's preferences inside
// the caller's transaction, the row locked from its read to its write, so
// two updates at once (two devices each switching a kind) both land
// (review L4). An update that does not read is a *FaultError.
func UpdatePreferences(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, apply func(Preferences) (Preferences, map[string]string)) error {
	if _, err := tx.Exec(ctx, `insert into app.notification_preferences (account_id) values ($1) on conflict (account_id) do nothing`,
		accountID); err != nil {
		return fmt.Errorf("notify: preferences %s: %w", accountID, err)
	}
	p, err := readPreferences(ctx, tx, accountID, " for update")
	if err != nil {
		return err
	}
	next, faults := apply(p)
	if faults != nil {
		return &FaultError{Faults: faults}
	}
	return writePreferences(ctx, tx, accountID, next)
}
