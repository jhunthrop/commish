package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is every read and write of app.entitlements.
type Store struct{ Pool *pgxpool.Pool }

// liveClause is the one definition of a row that grants its features
// at $now: a live status, started, and not yet ended.
//
// A row is started once either clock says so: starts_at is stamped by
// the database's now() and $now is the API's clock, and the two drift
// by milliseconds. Read against $now alone, a pass granted a moment ago
// by a database clock running ahead is not yet live, so a second
// checkout or the webhook's duplicate guard misses it (measured: 40 to
// 60 ms locally, enough for two passes in one season to both grant).
const liveClause = `e.status in ` + liveStatuses + ` and e.starts_at <= greatest($2, statement_timestamp()) and (e.ends_at is null or e.ends_at > $2)`

// Can answers whether the account may use feature at now, from the
// tables alone.
func (s *Store) Can(ctx context.Context, accountID uuid.UUID, feature Feature, now time.Time) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		select exists (
		  select 1 from app.entitlements e
		  join app.product_features pf on pf.product = e.product
		  where e.account_id = $1 and `+liveClause+` and pf.feature = $3
		)`, accountID, now, string(feature)).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("entitlements: can %s %s: %w", accountID, feature, err)
	}
	return ok, nil
}

// Features lists every feature the account has at now.
func (s *Store) Features(ctx context.Context, accountID uuid.UUID, now time.Time) ([]Feature, error) {
	rows, err := s.Pool.Query(ctx, `
		select distinct pf.feature from app.entitlements e
		join app.product_features pf on pf.product = e.product
		where e.account_id = $1 and `+liveClause+`
		order by pf.feature`, accountID, now)
	if err != nil {
		return nil, fmt.Errorf("entitlements: features %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Feature, error) {
		var f string
		err := r.Scan(&f)
		return Feature(f), err
	})
	if err != nil {
		return nil, fmt.Errorf("entitlements: features %s: %w", accountID, err)
	}
	return out, nil
}

// Pass is the account's live Draft Pass.
type Pass struct {
	Season int
	EndsAt time.Time
	Source Source
}

// LivePass is the live Draft Pass that lasts longest, nil when none.
func (s *Store) LivePass(ctx context.Context, accountID uuid.UUID, now time.Time) (*Pass, error) {
	var p Pass
	err := s.Pool.QueryRow(ctx, `
		select e.season, e.ends_at, e.source from app.entitlements e
		where e.account_id = $1 and e.product = 'draft_pass' and `+liveClause+`
		order by e.ends_at desc limit 1`, accountID, now).Scan(&p.Season, &p.EndsAt, &p.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("entitlements: live pass %s: %w", accountID, err)
	}
	return &p, nil
}

// Membership is a subscription row's state.
type Membership struct {
	EntitlementID     int64
	AccountID         uuid.UUID
	SubscriptionID    string
	Status            string
	Interval          *string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
}

const membershipColumns = `e.id, e.account_id, e.stripe_subscription_id, e.status, e.billing_interval,
	e.current_period_end, e.cancel_at_period_end`

func scanMembership(row pgx.Row) (Membership, error) {
	var m Membership
	err := row.Scan(&m.EntitlementID, &m.AccountID, &m.SubscriptionID, &m.Status, &m.Interval,
		&m.CurrentPeriodEnd, &m.CancelAtPeriodEnd)
	return m, err
}

// LatestMembership is the account's most recent subscription that got
// past checkout, live or not, so the account page can still show a
// canceled one. nil when there is none.
func (s *Store) LatestMembership(ctx context.Context, accountID uuid.UUID) (*Membership, error) {
	m, err := scanMembership(s.Pool.QueryRow(ctx, `
		select `+membershipColumns+` from app.entitlements e
		where e.account_id = $1 and e.source = 'subscription'
		  and e.status not in ('incomplete', 'incomplete_expired')
		order by e.created_at desc limit 1`, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("entitlements: latest membership %s: %w", accountID, err)
	}
	return &m, nil
}

// LiveMembership is the account's live subscription, nil when none.
func (s *Store) LiveMembership(ctx context.Context, accountID uuid.UUID, now time.Time) (*Membership, error) {
	m, err := scanMembership(s.Pool.QueryRow(ctx, `
		select `+membershipColumns+` from app.entitlements e
		where e.account_id = $1 and e.source = 'subscription' and `+liveClause+`
		order by e.created_at desc limit 1`, accountID, now))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("entitlements: live membership %s: %w", accountID, err)
	}
	return &m, nil
}

// HasLivePass reports whether the account already holds a live Draft
// Pass for season, from any source.
func (s *Store) HasLivePass(ctx context.Context, accountID uuid.UUID, season int, now time.Time) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		select exists (select 1 from app.entitlements e
		  where e.account_id = $1 and e.product = 'draft_pass' and e.season = $3 and `+liveClause+`)`,
		accountID, now, season).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("entitlements: has pass %s %d: %w", accountID, season, err)
	}
	return ok, nil
}

// HasOtherLivePass reports whether the account holds a live Draft Pass
// for season that checkout session checkoutSessionID did not buy: the
// webhook's duplicate guard.
func (s *Store) HasOtherLivePass(ctx context.Context, accountID uuid.UUID, season int, checkoutSessionID string, now time.Time) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		select exists (select 1 from app.entitlements e
		  where e.account_id = $1 and e.product = 'draft_pass' and e.season = $3 and `+liveClause+`
		    and e.stripe_checkout_session_id is distinct from $4)`,
		accountID, now, season, checkoutSessionID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("entitlements: other pass %s %d: %w", accountID, season, err)
	}
	return ok, nil
}

// LiveSubscriptionIDs lists every Stripe subscription a row still
// believes live: the nightly reconcile's input.
func (s *Store) LiveSubscriptionIDs(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		select e.stripe_subscription_id from app.entitlements e
		where e.source = 'subscription' and e.status not in ('canceled', 'incomplete_expired')`)
	if err != nil {
		return nil, fmt.Errorf("entitlements: live subscription ids: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("entitlements: live subscription ids: %w", err)
	}
	return ids, nil
}

// Renewal is one subscription renewing inside the reminder window.
type Renewal struct {
	Membership
	Email string
}

// RenewalsDue lists live subscriptions that renew in [from, to) and set
// to renew, with no reminder recorded for that period yet.
func (s *Store) RenewalsDue(ctx context.Context, from, to time.Time) ([]Renewal, error) {
	rows, err := s.Pool.Query(ctx, `
		select `+membershipColumns+`, a.email from app.entitlements e
		join app.accounts a on a.id = e.account_id
		where e.source = 'subscription' and e.status in ('active', 'trialing')
		  and not e.cancel_at_period_end
		  and e.current_period_end >= $1 and e.current_period_end < $2
		  and not exists (select 1 from app.renewal_reminders r
		                  where r.entitlement_id = e.id and r.period_end = e.current_period_end)
		order by e.current_period_end`, from, to)
	if err != nil {
		return nil, fmt.Errorf("entitlements: renewals due: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Renewal, error) {
		var x Renewal
		err := r.Scan(&x.EntitlementID, &x.AccountID, &x.SubscriptionID, &x.Status, &x.Interval,
			&x.CurrentPeriodEnd, &x.CancelAtPeriodEnd, &x.Email)
		return x, err
	})
	if err != nil {
		return nil, fmt.Errorf("entitlements: renewals due: %w", err)
	}
	return out, nil
}

// RecordReminder marks a renewal's reminder sent. sent is false when it
// already was, so two overlapping runs never mail twice.
func (s *Store) RecordReminder(ctx context.Context, entitlementID int64, periodEnd time.Time) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `
		insert into app.renewal_reminders (entitlement_id, period_end) values ($1, $2)
		on conflict do nothing`, entitlementID, periodEnd)
	if err != nil {
		return false, fmt.Errorf("entitlements: record reminder %d: %w", entitlementID, err)
	}
	return tag.RowsAffected() == 1, nil
}

// ForgetReminder removes a reminder record whose mail failed, so the
// next run tries again.
func (s *Store) ForgetReminder(ctx context.Context, entitlementID int64, periodEnd time.Time) error {
	if _, err := s.Pool.Exec(ctx,
		`delete from app.renewal_reminders where entitlement_id = $1 and period_end = $2`,
		entitlementID, periodEnd); err != nil {
		return fmt.Errorf("entitlements: forget reminder %d: %w", entitlementID, err)
	}
	return nil
}
