package account_test

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/account"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/season"
)

var viewNow = time.Date(2026, time.October, 13, 15, 0, 0, 0, time.UTC)

// newAccount writes an account row and returns it as auth reads it.
func newAccount(t *testing.T, ctx context.Context, store *entitlements.Store, workosID string) auth.Account {
	t.Helper()
	a := auth.Account{WorkOSUserID: workosID, Email: workosID + "@example.com"}
	if err := store.Pool.QueryRow(ctx,
		`insert into app.accounts (workos_user_id, email) values ($1, $2) returning id, created_at`,
		a.WorkOSUserID, a.Email).Scan(&a.ID, &a.CreatedAt); err != nil {
		t.Fatal(err)
	}
	return a
}

func view(t *testing.T, ctx context.Context, store *entitlements.Store, a auth.Account) *apitypes.MembershipState {
	t.Helper()
	v := &account.Viewer{Entitlements: store, Now: func() time.Time { return viewNow }}
	got, err := v.View(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	return got.Membership
}

// A granted Membership is the account's Membership: the bug was a
// membership read from subscriptions only, so a grant answered null and
// the account page read Free.
func TestViewGrantedMembership(t *testing.T) {
	ctx := context.Background()
	store := &entitlements.Store{Pool: dbtest.Pool(t)}
	a := newAccount(t, ctx, store, "user_granted")
	endsAt := viewNow.AddDate(1, 0, 0)
	if err := store.Grant(ctx, a.ID, entitlements.ProductMembership, 0, endsAt, "test"); err != nil {
		t.Fatal(err)
	}

	m := view(t, ctx, store, a)
	if m == nil {
		t.Fatal("membership is nil for a granted Membership")
	}
	if m.Source != apitypes.MembershipStateSourceGrant || m.Status != entitlements.StatusActive {
		t.Errorf("source, status = %s, %s, want grant, active", m.Source, m.Status)
	}
	if m.EndsAt == nil || !m.EndsAt.Equal(endsAt) {
		t.Errorf("ends_at = %v, want %v", m.EndsAt, endsAt)
	}
	if m.StartsAt.IsZero() {
		t.Error("starts_at is zero")
	}
	if m.Interval != nil || m.CurrentPeriodEnd != nil || m.CancelAtPeriodEnd != nil {
		t.Errorf("a grant carries billing: interval %v, period end %v, cancel %v",
			m.Interval, m.CurrentPeriodEnd, m.CancelAtPeriodEnd)
	}
}

// A subscription answers with its billing, and is the one shown when a
// grant is live beside it, so its cancel stays in reach.
func TestViewSubscriptionMembership(t *testing.T) {
	ctx := context.Background()
	store := &entitlements.Store{Pool: dbtest.Pool(t)}
	a := newAccount(t, ctx, store, "user_subscribed")
	periodEnd := viewNow.AddDate(0, 1, 0)
	if err := store.UpsertSubscription(ctx, entitlements.SubscriptionState{
		AccountID: a.ID, SubscriptionID: "sub_view_1", Status: "active", Interval: "month",
		CurrentPeriodEnd: periodEnd, CancelAtPeriodEnd: true, GrantedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Grant(ctx, a.ID, entitlements.ProductMembership, 0, viewNow.AddDate(1, 0, 0), "test"); err != nil {
		t.Fatal(err)
	}

	m := view(t, ctx, store, a)
	if m == nil {
		t.Fatal("membership is nil for a subscription")
	}
	if m.Source != apitypes.MembershipStateSourceSubscription {
		t.Errorf("source = %s, want subscription", m.Source)
	}
	if m.Interval == nil || *m.Interval != apitypes.IntervalMonth {
		t.Errorf("interval = %v, want month", m.Interval)
	}
	if m.CurrentPeriodEnd == nil || !m.CurrentPeriodEnd.Equal(periodEnd) {
		t.Errorf("current_period_end = %v, want %v", m.CurrentPeriodEnd, periodEnd)
	}
	if m.CancelAtPeriodEnd == nil || !*m.CancelAtPeriodEnd {
		t.Errorf("cancel_at_period_end = %v, want true", m.CancelAtPeriodEnd)
	}
	wantEnd := periodEnd.Add(entitlements.SubscriptionGrace)
	if m.EndsAt == nil || !m.EndsAt.Equal(wantEnd) {
		t.Errorf("ends_at = %v, want %v", m.EndsAt, wantEnd)
	}
}

type fixedSeason struct{ p season.SitePhase }

func (f fixedSeason) Phase(context.Context) season.SitePhase { return f.p }

// The Account answer carries the site's season as the season source
// reads it, and says so when none is wired.
func TestViewCarriesTheSiteSeason(t *testing.T) {
	ctx := context.Background()
	store := &entitlements.Store{Pool: dbtest.Pool(t)}
	a := newAccount(t, ctx, store, "user_season")
	v := &account.Viewer{Entitlements: store, Now: func() time.Time { return viewNow },
		Season: fixedSeason{season.SitePhase{Phase: season.SiteInSeason, Week: 6, Basis: "Week 6 of the 2026 NFL season is under way."}}}
	got, err := v.View(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if got.Season.Phase != apitypes.SiteSeasonPhaseInSeason || got.Season.Week != 6 || got.Season.Basis == "" {
		t.Fatalf("season %+v", got.Season)
	}
	v.Season = nil
	if got, err = v.View(ctx, a); err != nil || !got.Season.Phase.Valid() || got.Season.Basis == "" {
		t.Fatalf("with no season source: %+v (%v)", got.Season, err)
	}
}
