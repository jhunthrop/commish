package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Ending is why a paid grant stopped before its time.
type Ending string

const (
	EndRefunded Ending = StatusRefunded
	EndDisputed Ending = "disputed"
)

// EndPayment ends every pass bought with paymentIntentID, directly or
// as a group pass, and closes that group pass to further claims. It
// returns how many passes it ended.
func (s *Store) EndPayment(ctx context.Context, paymentIntentID string, why Ending, actor string) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			update app.entitlements set status = $2, granted_by = $3
			where stripe_payment_intent_id = $1 and status = 'active'`, paymentIntentID, string(why), actor)
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		var groupPassID uuid.UUID
		err = tx.QueryRow(ctx, `
			update app.group_passes set status = $2
			where stripe_payment_intent_id = $1 and status = 'active' returning id`,
			paymentIntentID, string(why)).Scan(&groupPassID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		tag, err = tx.Exec(ctx, `
			update app.entitlements set status = $2, granted_by = $3
			where group_pass_id = $1 and status = 'active'`, groupPassID, string(why), actor)
		n += tag.RowsAffected()
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("entitlements: end payment %s: %w", paymentIntentID, err)
	}
	return n, nil
}

// RestorePayment undoes a dispute's ending once the dispute is won: the
// passes the payment bought, and its group pass, are live again. A
// refund is never undone.
func (s *Store) RestorePayment(ctx context.Context, paymentIntentID, actor string) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			update app.entitlements set status = 'active', granted_by = $2
			where stripe_payment_intent_id = $1 and status = 'disputed'`, paymentIntentID, actor)
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		var groupPassID uuid.UUID
		err = tx.QueryRow(ctx, `
			update app.group_passes set status = 'active'
			where stripe_payment_intent_id = $1 and status = 'disputed' returning id`, paymentIntentID).Scan(&groupPassID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		tag, err = tx.Exec(ctx, `
			update app.entitlements set status = 'active', granted_by = $2
			where group_pass_id = $1 and status = 'disputed'`, groupPassID, actor)
		n += tag.RowsAffected()
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("entitlements: restore payment %s: %w", paymentIntentID, err)
	}
	return n, nil
}

// EndSubscription ends a Membership now, for a dispute: Stripe cancels
// the subscription too, and the deletion webhook that follows only
// confirms it.
func (s *Store) EndSubscription(ctx context.Context, subscriptionID string, why Ending, now time.Time, actor string) error {
	if _, err := s.Pool.Exec(ctx, `
		update app.entitlements set status = $2, ends_at = $3, granted_by = $4
		where stripe_subscription_id = $1`, subscriptionID, string(why), now, actor); err != nil {
		return fmt.Errorf("entitlements: end subscription %s: %w", subscriptionID, err)
	}
	return nil
}
