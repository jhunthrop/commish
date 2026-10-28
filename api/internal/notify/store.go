package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The data fields the outbox reads, stripped from the payload a device
// receives.
const (
	// DedupeKey is the producer's dedupe key: one row per account, kind and
	// key (app.notifications' notifications_key).
	DedupeKey = "key"
	// TopicKey names what a row is about (the starter status producer's
	// player): a newer row for the same account, kind and topic gives up
	// the older unsent ones, so a member never hears "cleared" before
	// "out" from rows released together (review M4).
	TopicKey = "topic"
	// TopicAtKey is when the row's news happened, Unix seconds, read with
	// its topic: only a row about something later gives up another, so a
	// catch-up that queues an older change after a newer one never gives
	// up the newer.
	TopicAtKey = "topic_at"
)

// deadAttempts is what a row given up for good is marked with: past
// every drain's bound, so no claim takes it again.
const deadAttempts = 1000

// ErrNoSendAfter is a row a producer queued without saying when it may
// go: every producer applies the member's quiet hours (prefs.SendAfter).
var ErrNoSendAfter = errors.New("notify: a row needs its send_after")

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
	// Attempts is the row's attempts counted, this claim's among them: the
	// fence every mark of a claim checks (review L2).
	Attempts int
}

// Store is the outbox, the preferences, the registrations the job reads,
// the APNs provider token and the producers' marks. Every query is
// scoped by account, by row, by device or by key.
type Store struct{ Pool *pgxpool.Pool }

// Enqueue inserts the rows, skipping any whose dedupe key the account
// already holds for the kind, and answers how many it inserted. A row
// inserted with a topic gives up the account's older unsent rows of the
// kind on that topic, in the same transaction.
func (s *Store) Enqueue(ctx context.Context, rows []Notification) (int, error) {
	for _, n := range rows {
		if n.SendAfter.IsZero() {
			return 0, ErrNoSendAfter
		}
	}
	inserted := 0
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, n := range rows {
			ok, err := insertRow(ctx, tx, n, 0)
			if err != nil {
				return err
			}
			if ok {
				inserted++
			}
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("notify: enqueue: %w", err)
	}
	return inserted, nil
}

// insertRow inserts one row with its attempts, and on a topic gives up
// the older unsent rows; inserted is false for a dedupe key already held.
func insertRow(ctx context.Context, tx pgx.Tx, n Notification, attempts int) (bool, error) {
	fields := n.Data
	if fields == nil {
		fields = map[string]string{}
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return false, err
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `insert into app.notifications (account_id, device_id, kind, title, body, data, send_after, attempts)
		values ($1, $2, $3, $4, $5, $6, $7, $8)
		on conflict (account_id, kind, (data ->> 'key')) where data ? 'key' do nothing
		returning id`,
		n.AccountID, n.DeviceID, string(n.Kind), n.Title, n.Body, data, n.SendAfter, attempts).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if topic := fields[TopicKey]; topic != "" {
		if err := supersede(ctx, tx, n, id, topic, fields[TopicAtKey]); err != nil {
			return false, err
		}
	}
	return true, nil
}

// supersede gives up the account's unsent rows of the kind on the topic
// about something earlier than the row just inserted, and gives up the
// row itself when one about something later is already queued.
func supersede(ctx context.Context, tx pgx.Tx, n Notification, id uuid.UUID, topic, at string) error {
	when, err := strconv.ParseInt(at, 10, 64)
	if err != nil {
		return fmt.Errorf("notify: a row with a topic needs its %s: %w", TopicAtKey, err)
	}
	const onTopic = `account_id = $1 and kind = $2 and data ->> 'topic' = $3 and id <> $4`
	if _, err := tx.Exec(ctx, `update app.notifications set failed_at = now(), attempts = greatest(attempts, $6)
		where `+onTopic+` and sent_at is null and (data ->> 'topic_at')::bigint < $5`,
		n.AccountID, string(n.Kind), topic, id, when, deadAttempts); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update app.notifications set failed_at = now(), attempts = $6 where id = $4
		and exists (select 1 from app.notifications where `+onTopic+` and (data ->> 'topic_at')::bigint > $5)`,
		n.AccountID, string(n.Kind), topic, id, when, deadAttempts)
	return err
}

// Claim leases up to limit due rows: each claimed row's send_after moves
// past the lease and its attempt is counted, in one statement, so two
// runs never claim one row and a run that stops mid-send leaves it to
// the run after the lease. A row at maxAttempts is dead and never
// claimed again. Rows go in the order they were due and queued.
func (s *Store) Claim(ctx context.Context, now time.Time, lease time.Duration, limit, maxAttempts int) ([]Notification, error) {
	rows, err := s.Pool.Query(ctx, `with due as (
			select id from app.notifications
			where sent_at is null and send_after <= $1 and attempts < $4
			order by send_after, created_at, id limit $3 for update skip locked)
		update app.notifications n set send_after = $2, attempts = n.attempts + 1
		from due where n.id = due.id
		returning n.id, n.account_id, n.device_id, n.kind, n.title, n.body, n.data, n.send_after, n.attempts, n.created_at`,
		now, now.Add(lease), limit, maxAttempts)
	if err != nil {
		return nil, fmt.Errorf("notify: claim: %w", err)
	}
	type claimed struct {
		Notification
		created time.Time
	}
	got, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (claimed, error) {
		var c claimed
		var kind string
		var data []byte
		if err := r.Scan(&c.ID, &c.AccountID, &c.DeviceID, &kind, &c.Title, &c.Body, &data, &c.SendAfter, &c.Attempts, &c.created); err != nil {
			return c, err
		}
		c.Kind = Kind(kind)
		return c, json.Unmarshal(data, &c.Data)
	})
	if err != nil {
		return nil, fmt.Errorf("notify: claim: %w", err)
	}
	// The update's returning order is not the select's.
	slices.SortFunc(got, func(a, b claimed) int {
		if c := a.SendAfter.Compare(b.SendAfter); c != 0 {
			return c
		}
		if c := a.created.Compare(b.created); c != 0 {
			return c
		}
		return strings.Compare(a.ID.String(), b.ID.String())
	})
	out := make([]Notification, len(got))
	for i, c := range got {
		out[i] = c.Notification
	}
	return out, nil
}

// The marks of a claim. Each holds only while the run still holds the
// claim (the attempts it was claimed at, still unsent): a run whose lease
// ran out never writes over a later run's (review L2). held is false when
// the claim was lost.

// MarkSent records a delivered row.
func (s *Store) MarkSent(ctx context.Context, n Notification, at time.Time) (bool, error) {
	return s.mark(ctx, `update app.notifications set sent_at = $3 where id = $1 and attempts = $2 and sent_at is null`, n, at)
}

// MarkRetry records a failed send that goes again at retryAt.
func (s *Store) MarkRetry(ctx context.Context, n Notification, at, retryAt time.Time) (bool, error) {
	return s.mark(ctx, `update app.notifications set failed_at = $3, send_after = $4
		where id = $1 and attempts = $2 and sent_at is null`, n, at, retryAt)
}

// MarkDead records a row that will never send.
func (s *Store) MarkDead(ctx context.Context, n Notification, at time.Time) (bool, error) {
	return s.mark(ctx, `update app.notifications set failed_at = $3, attempts = $4
		where id = $1 and attempts = $2 and sent_at is null`, n, at, deadAttempts)
}

// Release gives back claimed rows a run did not try (its budget spent, or
// cancelled): due again at at, their attempt not counted (review M3).
func (s *Store) Release(ctx context.Context, rows []Notification, at time.Time) error {
	for _, n := range rows {
		if _, err := s.mark(ctx, `update app.notifications set send_after = $3, attempts = attempts - 1
			where id = $1 and attempts = $2 and sent_at is null`, n, at); err != nil {
			return err
		}
	}
	return nil
}

// SentWithChildren marks a row sent to every device but those listed
// and, in the same transaction, queues one child row per listed device
// (its device set, the row's attempts, its own key) to retry it there
// alone (review M1). A child's key is the row's key, or id, and the
// device's, so a second drain of the same row adds nothing.
func (s *Store) SentWithChildren(ctx context.Context, n Notification, at, retryAt time.Time, devices []uuid.UUID) (bool, error) {
	held := false
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `update app.notifications set sent_at = $3 where id = $1 and attempts = $2 and sent_at is null`,
			n.ID, n.Attempts, at)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		held = true
		for _, device := range devices {
			if _, err := insertRow(ctx, tx, childOf(n, device, retryAt), n.Attempts); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("notify: sent with children %s: %w", n.ID, err)
	}
	return held, nil
}

// childOf is the row aimed at one device, due at retryAt.
func childOf(n Notification, device uuid.UUID, retryAt time.Time) Notification {
	data := make(map[string]string, len(n.Data)+1)
	for k, v := range n.Data {
		data[k] = v
	}
	parent := n.Data[DedupeKey]
	if parent == "" {
		parent = n.ID.String()
	}
	data[DedupeKey] = parent + ":" + device.String()
	d := device
	return Notification{AccountID: n.AccountID, DeviceID: &d, Kind: n.Kind, Title: n.Title, Body: n.Body, Data: data, SendAfter: retryAt}
}

func (s *Store) mark(ctx context.Context, query string, n Notification, args ...any) (bool, error) {
	tag, err := s.Pool.Exec(ctx, query, append([]any{n.ID, n.Attempts}, args...)...)
	if err != nil {
		return false, fmt.Errorf("notify: mark %s: %w", n.ID, err)
	}
	return tag.RowsAffected() > 0, nil
}
