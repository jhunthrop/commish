package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DedupeKey is the data field a producer's dedupe key rides in: one row
// per account, kind and key (app.notifications' notifications_key). It is
// stripped from the payload a device receives.
const DedupeKey = "key"

// Notification is one row of the outbox. Data is the payload the device
// receives, string values only (FCM's data message takes no other).
type Notification struct {
	ID        uuid.UUID
	AccountID uuid.UUID
	// DeviceID is the one device it goes to, nil for every device the
	// account has registered.
	DeviceID  *uuid.UUID
	Kind      Kind
	Title     string
	Body      string
	Data      map[string]string
	SendAfter time.Time
	Attempts  int
}

// Target is one registered device a notification goes to.
type Target struct {
	DeviceID uuid.UUID
	Platform Platform
	Token    string
}

// maxPushAccounts bounds the accounts one producer run reads.
const maxPushAccounts = 20000

// Store is the outbox, the preferences and the registrations the job
// reads. Every query is scoped by account, by row or by device.
type Store struct{ Pool *pgxpool.Pool }

// Enqueue inserts the rows, skipping any whose dedupe key the account
// already holds for the kind, and answers how many it inserted.
func (s *Store) Enqueue(ctx context.Context, rows []Notification) (int, error) {
	inserted := 0
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, n := range rows {
			fields := n.Data
			if fields == nil {
				fields = map[string]string{}
			}
			data, err := json.Marshal(fields)
			if err != nil {
				return err
			}
			tag, err := tx.Exec(ctx, `insert into app.notifications (account_id, device_id, kind, title, body, data, send_after)
				values ($1, $2, $3, $4, $5, $6, $7)
				on conflict (account_id, kind, (data ->> 'key')) where data ? 'key' do nothing`,
				n.AccountID, n.DeviceID, string(n.Kind), n.Title, n.Body, data, n.SendAfter)
			if err != nil {
				return err
			}
			inserted += int(tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("notify: enqueue: %w", err)
	}
	return inserted, nil
}

// Claim leases up to limit due rows: each claimed row's send_after moves
// past the lease and its attempt is counted, in one statement, so two
// runs never claim one row and a run that stops mid-send leaves it to
// the run after the lease. A row at maxAttempts is dead and never
// claimed again.
func (s *Store) Claim(ctx context.Context, now time.Time, lease time.Duration, limit, maxAttempts int) ([]Notification, error) {
	rows, err := s.Pool.Query(ctx, `with due as (
			select id from app.notifications
			where sent_at is null and send_after <= $1 and attempts < $4
			order by send_after, id limit $3 for update skip locked)
		update app.notifications n set send_after = $2, attempts = n.attempts + 1
		from due where n.id = due.id
		returning n.id, n.account_id, n.device_id, n.kind, n.title, n.body, n.data, n.send_after, n.attempts`,
		now, now.Add(lease), limit, maxAttempts)
	if err != nil {
		return nil, fmt.Errorf("notify: claim: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Notification, error) {
		var n Notification
		var kind string
		var data []byte
		if err := r.Scan(&n.ID, &n.AccountID, &n.DeviceID, &kind, &n.Title, &n.Body, &data, &n.SendAfter, &n.Attempts); err != nil {
			return n, err
		}
		n.Kind = Kind(kind)
		return n, json.Unmarshal(data, &n.Data)
	})
	if err != nil {
		return nil, fmt.Errorf("notify: claim: %w", err)
	}
	return out, nil
}

// MarkSent records a delivered row.
func (s *Store) MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error {
	return s.mark(ctx, `update app.notifications set sent_at = $2 where id = $1`, id, at)
}

// MarkRetry records a failed send that goes again at retryAt.
func (s *Store) MarkRetry(ctx context.Context, id uuid.UUID, at, retryAt time.Time) error {
	return s.mark(ctx, `update app.notifications set failed_at = $2, send_after = $3 where id = $1`, id, at, retryAt)
}

// MarkDead records a row that will never send: its attempts are raised
// to the bound, so no claim takes it again.
func (s *Store) MarkDead(ctx context.Context, id uuid.UUID, at time.Time, maxAttempts int) error {
	return s.mark(ctx, `update app.notifications set failed_at = $2, attempts = greatest(attempts, $3) where id = $1`, id, at, maxAttempts)
}

func (s *Store) mark(ctx context.Context, query string, id uuid.UUID, args ...any) error {
	if _, err := s.Pool.Exec(ctx, query, append([]any{id}, args...)...); err != nil {
		return fmt.Errorf("notify: mark %s: %w", id, err)
	}
	return nil
}

// Targets is the account's live devices with a push token: the one
// device when deviceID is set, else every one.
func (s *Store) Targets(ctx context.Context, accountID uuid.UUID, deviceID *uuid.UUID) ([]Target, error) {
	rows, err := s.Pool.Query(ctx, `select id, push_platform, push_token from app.devices
		where account_id = $1 and revoked_at is null and push_token is not null and ($2::uuid is null or id = $2)
		order by created_at, id`, accountID, deviceID)
	if err != nil {
		return nil, fmt.Errorf("notify: targets %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Target, error) {
		var t Target
		var platform string
		err := r.Scan(&t.DeviceID, &platform, &t.Token)
		t.Platform = Platform(platform)
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("notify: targets %s: %w", accountID, err)
	}
	return out, nil
}

// DropToken removes a token the platform called dead, only while the
// device still holds that same token (a fresh one registered meanwhile
// stays).
func (s *Store) DropToken(ctx context.Context, deviceID uuid.UUID, token string) error {
	_, err := s.Pool.Exec(ctx, `update app.devices set push_platform = null, push_token = null, push_registered_at = null
		where id = $1 and push_token = $2`, deviceID, token)
	if err != nil {
		return fmt.Errorf("notify: drop token %s: %w", deviceID, err)
	}
	return nil
}

// PushAccounts is every account with a live device registered for push
// and the kind switched on: the accounts a producer may write for.
func (s *Store) PushAccounts(ctx context.Context, kind Kind) ([]uuid.UUID, error) {
	rows, err := s.Pool.Query(ctx, `select distinct d.account_id from app.devices d
		left join app.notification_preferences p on p.account_id = d.account_id
		where d.revoked_at is null and d.push_token is not null and not (coalesce(p.kinds_off, '{}') @> array[$1]::text[])
		order by 1 limit $2`, string(kind), maxPushAccounts)
	if err != nil {
		return nil, fmt.Errorf("notify: push accounts: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("notify: push accounts: %w", err)
	}
	return out, nil
}

// Preferences is the account's push preferences, the defaults when it
// changed none.
func (s *Store) Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error) {
	p := DefaultPreferences()
	var off []string
	err := s.Pool.QueryRow(ctx, `select time_zone, quiet_start, quiet_end, kinds_off from app.notification_preferences
		where account_id = $1`, accountID).Scan(&p.TimeZone, &p.QuietStart, &p.QuietEnd, &off)
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
	off := make([]string, len(p.Off))
	for i, k := range p.Off {
		off[i] = string(k)
	}
	_, err := s.Pool.Exec(ctx, `insert into app.notification_preferences (account_id, time_zone, quiet_start, quiet_end, kinds_off)
		values ($1, $2, $3, $4, $5)
		on conflict (account_id) do update set time_zone = excluded.time_zone, quiet_start = excluded.quiet_start,
			quiet_end = excluded.quiet_end, kinds_off = excluded.kinds_off, updated_at = now()`,
		accountID, p.TimeZone, p.QuietStart, p.QuietEnd, off)
	if err != nil {
		return fmt.Errorf("notify: put preferences %s: %w", accountID, err)
	}
	return nil
}
