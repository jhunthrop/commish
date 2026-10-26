package billing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db"
)

// ErrNoGroupPass is a claim code that names no group pass.
var ErrNoGroupPass = errors.New("billing: no such group pass")

// Store is app.billing_customers, app.billing_events and
// app.group_passes. It never touches app.entitlements.
type Store struct{ Pool *pgxpool.Pool }

// CustomerID reads the account's Stripe customer, ok false when none.
func (s *Store) CustomerID(ctx context.Context, accountID uuid.UUID) (string, bool, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `select stripe_customer_id from app.billing_customers where account_id = $1`, accountID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("billing: customer %s: %w", accountID, err)
	}
	return id, true, nil
}

// SaveCustomerID records the account's Stripe customer.
func (s *Store) SaveCustomerID(ctx context.Context, accountID uuid.UUID, customerID string) error {
	if _, err := s.Pool.Exec(ctx, `
		insert into app.billing_customers (account_id, stripe_customer_id) values ($1, $2)
		on conflict (account_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
		accountID, customerID); err != nil {
		return fmt.Errorf("billing: save customer %s: %w", accountID, err)
	}
	return nil
}

// RecordEventOnce is the webhook's idempotency gate. proceed is true
// the first time an event id is seen, and again when an earlier attempt
// recorded it but failed before finishing; false once it was processed.
func (s *Store) RecordEventOnce(ctx context.Context, id, eventType string, payload []byte) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `
		insert into app.billing_events (id, type, payload) values ($1, $2, $3) on conflict (id) do nothing`,
		id, eventType, payload)
	if err != nil {
		return false, fmt.Errorf("billing: record event %s: %w", id, err)
	}
	if tag.RowsAffected() == 1 {
		return true, nil
	}
	var processedAt *time.Time
	if err := s.Pool.QueryRow(ctx, `select processed_at from app.billing_events where id = $1`, id).Scan(&processedAt); err != nil {
		return false, fmt.Errorf("billing: event %s: %w", id, err)
	}
	return processedAt == nil, nil
}

// MarkEventProcessed stamps an event done once its writes committed,
// with what became of it.
func (s *Store) MarkEventProcessed(ctx context.Context, id string, o Outcome) error {
	if _, err := s.Pool.Exec(ctx, `
		update app.billing_events set processed_at = now(), outcome = $2, outcome_reason = $3 where id = $1`,
		id, string(o.Kind), nullable(o.Reason)); err != nil {
		return fmt.Errorf("billing: mark event %s: %w", id, err)
	}
	return nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// EventPayloadRetention is how long a billing event's (trimmed)
// payload is kept. The sweep job clears it after; the row stays.
const EventPayloadRetention = 90 * 24 * time.Hour

// ClearEventPayloads empties the payload of every event received before
// cutoff. The row, its type, times and outcome stay.
func (s *Store) ClearEventPayloads(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `
		update app.billing_events set payload = null, payload_cleared_at = now()
		where received_at < $1 and payload is not null`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("billing: clear event payloads: %w", err)
	}
	return tag.RowsAffected(), nil
}

// WithLock runs fn holding a Postgres advisory lock on key (db.WithLock).
func (s *Store) WithLock(ctx context.Context, key string, fn func(context.Context) error) error {
	return db.WithLock(ctx, s.Pool, key, fn)
}

// GroupPass is one row of app.group_passes with its claim count.
type GroupPass struct {
	ID uuid.UUID
	// PurchaserID is the buyer, nil once the buyer deleted their account
	// (the pass stays with the people who claimed it, migration 00033).
	PurchaserID *uuid.UUID
	LeagueName  string
	Season      int
	Seats       int
	Claimed     int
	ClaimCode   string
	Status      string
	CreatedAt   time.Time
}

const groupPassColumns = `g.id, g.purchaser_id, g.league_name, g.season, g.seats,
	(select count(*) from app.entitlements e where e.group_pass_id = g.id), g.claim_code, g.status, g.created_at`

func scanGroupPass(row pgx.Row) (GroupPass, error) {
	var g GroupPass
	err := row.Scan(&g.ID, &g.PurchaserID, &g.LeagueName, &g.Season, &g.Seats, &g.Claimed, &g.ClaimCode, &g.Status, &g.CreatedAt)
	return g, err
}

// NewGroupPass is a paid group pass to record.
type NewGroupPass struct {
	PurchaserID       uuid.UUID
	LeagueName        string
	Season            int
	Seats             int
	ClaimCode         string
	CheckoutSessionID string
	PaymentIntentID   string
}

// CreateGroupPass records a paid group pass, once per checkout session:
// a redelivered webhook writes nothing.
func (s *Store) CreateGroupPass(ctx context.Context, g NewGroupPass) error {
	var pi *string
	if g.PaymentIntentID != "" {
		pi = &g.PaymentIntentID
	}
	if _, err := s.Pool.Exec(ctx, `
		insert into app.group_passes (purchaser_id, league_name, season, seats, claim_code, stripe_checkout_session_id, stripe_payment_intent_id)
		values ($1, $2, $3, $4, $5, $6, $7)
		on conflict (stripe_checkout_session_id) do nothing`,
		g.PurchaserID, g.LeagueName, g.Season, g.Seats, g.ClaimCode, g.CheckoutSessionID, pi); err != nil {
		return fmt.Errorf("billing: create group pass %s: %w", g.CheckoutSessionID, err)
	}
	return nil
}

// GroupPassByCode reads the group pass a claim link names.
func (s *Store) GroupPassByCode(ctx context.Context, code string) (GroupPass, error) {
	g, err := scanGroupPass(s.Pool.QueryRow(ctx, `select `+groupPassColumns+` from app.group_passes g where g.claim_code = $1`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupPass{}, ErrNoGroupPass
	}
	if err != nil {
		return GroupPass{}, fmt.Errorf("billing: group pass by code: %w", err)
	}
	return g, nil
}

// GroupPassesBoughtBy lists the account's group passes, newest first.
func (s *Store) GroupPassesBoughtBy(ctx context.Context, accountID uuid.UUID) ([]GroupPass, error) {
	rows, err := s.Pool.Query(ctx, `select `+groupPassColumns+` from app.group_passes g
		where g.purchaser_id = $1 order by g.created_at desc`, accountID)
	if err != nil {
		return nil, fmt.Errorf("billing: group passes of %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (GroupPass, error) { return scanGroupPass(r) })
	if err != nil {
		return nil, fmt.Errorf("billing: group passes of %s: %w", accountID, err)
	}
	return out, nil
}

// ClaimedBy reports whether the account holds a claim on the group pass.
func (s *Store) ClaimedBy(ctx context.Context, groupPassID, accountID uuid.UUID) (bool, error) {
	var ok bool
	if err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.entitlements
		where group_pass_id = $1 and account_id = $2)`, groupPassID, accountID).Scan(&ok); err != nil {
		return false, fmt.Errorf("billing: claimed by %s: %w", accountID, err)
	}
	return ok, nil
}
