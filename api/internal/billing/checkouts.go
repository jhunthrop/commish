package billing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Checkout session states in app.checkout_sessions.
const (
	checkoutOpen      = "open"
	checkoutCompleted = "completed"
	checkoutExpired   = "expired"
)

// OpenCheckout is an account's unpaid checkout session for one product
// and season.
type OpenCheckout struct {
	SessionID string
	LookupKey string
	Quantity  int64
	URL       string
	ExpiresAt time.Time
}

// OpenCheckoutFor reads the account's open session for product and
// season, nil when there is none. A session past its expiry is closed
// here, since Stripe will no longer take payment on it.
func (s *Store) OpenCheckoutFor(ctx context.Context, accountID uuid.UUID, product string, seasonKey int, now time.Time) (*OpenCheckout, error) {
	var o OpenCheckout
	err := s.Pool.QueryRow(ctx, `
		select stripe_checkout_session_id, lookup_key, quantity, url, expires_at from app.checkout_sessions
		where account_id = $1 and product = $2 and season = $3 and status = 'open'`,
		accountID, product, seasonKey).Scan(&o.SessionID, &o.LookupKey, &o.Quantity, &o.URL, &o.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("billing: open checkout %s: %w", accountID, err)
	}
	if !now.Before(o.ExpiresAt) {
		return nil, s.CloseCheckout(ctx, o.SessionID, checkoutExpired)
	}
	return &o, nil
}

// RecordCheckout keeps a new open session. The unique index refuses a
// second open session for the same account, product and season.
func (s *Store) RecordCheckout(ctx context.Context, accountID uuid.UUID, product string, seasonKey int, lookupKey string, quantity int64, cs CheckoutSession) error {
	if _, err := s.Pool.Exec(ctx, `
		insert into app.checkout_sessions
		  (stripe_checkout_session_id, account_id, product, season, lookup_key, quantity, url, expires_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		cs.ID, accountID, product, seasonKey, lookupKey, quantity, cs.URL, cs.ExpiresAt); err != nil {
		return fmt.Errorf("billing: record checkout %s: %w", cs.ID, err)
	}
	return nil
}

// CloseCheckout marks a session completed or expired. A session we
// never recorded (one made outside our checkout) is a no-op.
func (s *Store) CloseCheckout(ctx context.Context, sessionID, status string) error {
	if _, err := s.Pool.Exec(ctx, `
		update app.checkout_sessions set status = $2 where stripe_checkout_session_id = $1 and status = 'open'`,
		sessionID, status); err != nil {
		return fmt.Errorf("billing: close checkout %s: %w", sessionID, err)
	}
	return nil
}
