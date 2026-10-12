package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jhunthrop/commish/api/internal/season"
)

// Claim errors.
var (
	ErrNoGroupPass     = errors.New("entitlements: no such group pass")
	ErrGroupPassFull   = errors.New("entitlements: every seat is claimed")
	ErrAlreadyClaimed  = errors.New("entitlements: already claimed")
	ErrGroupPassClosed = errors.New("entitlements: group pass refunded")
)

// PassGrant is one Draft Pass to write.
type PassGrant struct {
	AccountID         uuid.UUID
	Season            int
	Source            Source
	CheckoutSessionID string
	PaymentIntentID   string
	GrantedBy         string
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// GrantPass writes a Draft Pass for its season, ending at the season's
// end. A purchase is idempotent on its checkout session: a redelivered
// webhook writes nothing. created reports whether a row was written.
func (s *Store) GrantPass(ctx context.Context, g PassGrant) (created bool, err error) {
	tag, err := s.Pool.Exec(ctx, `
		insert into app.entitlements
		  (account_id, product, source, status, season, ends_at, stripe_checkout_session_id, stripe_payment_intent_id, granted_by)
		values ($1, 'draft_pass', $2, 'active', $3, $4, $5, $6, $7)
		on conflict (stripe_checkout_session_id) do nothing`,
		g.AccountID, string(g.Source), g.Season, season.End(g.Season),
		nullable(g.CheckoutSessionID), nullable(g.PaymentIntentID), g.GrantedBy)
	if err != nil {
		return false, fmt.Errorf("entitlements: grant pass %s %d: %w", g.AccountID, g.Season, err)
	}
	return tag.RowsAffected() == 1, nil
}

// SubscriptionState is a Stripe subscription as the webhook or the
// reconcile last read it.
type SubscriptionState struct {
	AccountID         uuid.UUID
	SubscriptionID    string
	Status            string
	Interval          string
	CurrentPeriodEnd  time.Time
	CancelAtPeriodEnd bool
	GrantedBy         string
}

// UpsertSubscription writes a Membership row from Stripe's state. Access
// ends SubscriptionGrace after the paid period, so a late webhook never
// locks a member out and a lapsed card always does, eventually.
func (s *Store) UpsertSubscription(ctx context.Context, st SubscriptionState) error {
	if _, err := s.Pool.Exec(ctx, `
		insert into app.entitlements
		  (account_id, product, source, status, ends_at, billing_interval, current_period_end,
		   cancel_at_period_end, stripe_subscription_id, granted_by)
		values ($1, 'membership', 'subscription', $2, $3, $4, $5, $6, $7, $8)
		on conflict (stripe_subscription_id) do update set
		  status = excluded.status, ends_at = excluded.ends_at, billing_interval = excluded.billing_interval,
		  current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
		  granted_by = excluded.granted_by`,
		st.AccountID, st.Status, st.CurrentPeriodEnd.Add(SubscriptionGrace), nullable(st.Interval),
		st.CurrentPeriodEnd, st.CancelAtPeriodEnd, st.SubscriptionID, st.GrantedBy); err != nil {
		return fmt.Errorf("entitlements: upsert subscription %s: %w", st.SubscriptionID, err)
	}
	return nil
}

// OtherLiveSubscription returns another live subscription the account
// holds besides subscriptionID, empty when none: the duplicate guard.
func (s *Store) OtherLiveSubscription(ctx context.Context, accountID uuid.UUID, subscriptionID string, now time.Time) (string, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `
		select e.stripe_subscription_id from app.entitlements e
		where e.account_id = $1 and e.source = 'subscription' and `+liveClause+`
		  and e.stripe_subscription_id <> $3
		limit 1`, accountID, now, subscriptionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("entitlements: other subscription %s: %w", accountID, err)
	}
	return id, nil
}

// SetCancelAtPeriodEnd records a cancellation (or its undoing) the
// moment the member asks, before Stripe's webhook confirms it.
func (s *Store) SetCancelAtPeriodEnd(ctx context.Context, subscriptionID string, cancel bool, actor string) error {
	if _, err := s.Pool.Exec(ctx, `
		update app.entitlements set cancel_at_period_end = $2, granted_by = $3
		where stripe_subscription_id = $1`, subscriptionID, cancel, actor); err != nil {
		return fmt.Errorf("entitlements: cancel at period end %s: %w", subscriptionID, err)
	}
	return nil
}

// RefundPayment ends every pass bought with paymentIntentID.
func (s *Store) RefundPayment(ctx context.Context, paymentIntentID, actor string) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `
		update app.entitlements set status = 'refunded', granted_by = $2
		where stripe_payment_intent_id = $1 and status <> 'refunded'`, paymentIntentID, actor)
	if err != nil {
		return 0, fmt.Errorf("entitlements: refund %s: %w", paymentIntentID, err)
	}
	return tag.RowsAffected(), nil
}

// RefundGroupPass ends every pass claimed from a group pass and closes
// it to further claims.
func (s *Store) RefundGroupPass(ctx context.Context, paymentIntentID, actor string) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `
			update app.group_passes set status = 'refunded'
			where stripe_payment_intent_id = $1 returning id`, paymentIntentID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			update app.entitlements set status = 'refunded', granted_by = $2
			where group_pass_id = $1 and status <> 'refunded'`, id, actor)
		n = tag.RowsAffected()
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("entitlements: refund group pass %s: %w", paymentIntentID, err)
	}
	return n, nil
}

// ClaimGroupPass writes one Draft Pass from a group pass, inside one
// transaction that locks the group pass row, so two claims racing for
// the last seat cannot both win.
func (s *Store) ClaimGroupPass(ctx context.Context, groupPassID, accountID uuid.UUID, actor string) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var seats, seasonYear int
		var status string
		err := tx.QueryRow(ctx, `
			select seats, season, status from app.group_passes where id = $1 for update`, groupPassID).
			Scan(&seats, &seasonYear, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoGroupPass
		}
		if err != nil {
			return err
		}
		if status != StatusActive {
			return ErrGroupPassClosed
		}
		var claimed int
		if err := tx.QueryRow(ctx, `
			select count(*) from app.entitlements where group_pass_id = $1`, groupPassID).Scan(&claimed); err != nil {
			return err
		}
		if claimed >= seats {
			return ErrGroupPassFull
		}
		_, err = tx.Exec(ctx, `
			insert into app.entitlements (account_id, product, source, status, season, ends_at, group_pass_id, granted_by)
			values ($1, 'draft_pass', 'group_pass', 'active', $2, $3, $4, $5)`,
			accountID, seasonYear, season.End(seasonYear), groupPassID, actor)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrAlreadyClaimed
		}
		return err
	})
	if err != nil && !errors.Is(err, ErrNoGroupPass) && !errors.Is(err, ErrGroupPassFull) &&
		!errors.Is(err, ErrAlreadyClaimed) && !errors.Is(err, ErrGroupPassClosed) {
		return fmt.Errorf("entitlements: claim group pass %s: %w", groupPassID, err)
	}
	return err
}

// Grant writes a hand grant of product for an account until endsAt,
// for support and for the founder's own accounts.
func (s *Store) Grant(ctx context.Context, accountID uuid.UUID, product Product, seasonYear int, endsAt time.Time, actor string) error {
	var seasonArg *int
	if product == ProductDraftPass {
		seasonArg = &seasonYear
	}
	if _, err := s.Pool.Exec(ctx, `
		insert into app.entitlements (account_id, product, source, status, season, ends_at, granted_by)
		values ($1, $2, 'grant', 'active', $3, $4, $5)`,
		accountID, string(product), seasonArg, endsAt, actor); err != nil {
		return fmt.Errorf("entitlements: grant %s %s: %w", product, accountID, err)
	}
	return nil
}
