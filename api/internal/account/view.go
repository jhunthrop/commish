// Package account builds the API's Account answer: who is signed in,
// what they can use, and the state of their pass and membership. /me,
// the membership routes and a group pass claim all answer with it, so
// it is built in one place.
package account

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/season"
)

// Entitlements is the part of entitlements.Store the view reads.
type Entitlements interface {
	Features(ctx context.Context, accountID uuid.UUID, now time.Time) ([]entitlements.Feature, error)
	LivePass(ctx context.Context, accountID uuid.UUID, now time.Time) (*entitlements.Pass, error)
	AccountMembership(ctx context.Context, accountID uuid.UUID, now time.Time) (*entitlements.HeldMembership, error)
}

// Viewer builds Account answers.
type Viewer struct {
	Entitlements Entitlements
	// Leagues answers the site's league context: the selected league,
	// every league followed, and the format pages open in. Nil answers
	// none.
	Leagues Leagues
	// Season answers the site's season (*season.Site). Nil answers
	// unwired, saying so.
	Season Season
	// Notifications answers the account's push settings (notify.Settings,
	// Lane 262). Nil leaves them off the answer, which a client reads as
	// the defaults.
	Notifications Notifications
	Now           func() time.Time
}

// Notifications is the push settings source.
type Notifications interface {
	Notifications(ctx context.Context, accountID uuid.UUID) (apitypes.NotificationSettings, error)
}

// Season is the site's season source. *season.Site implements it.
type Season interface {
	Phase(ctx context.Context) season.SitePhase
}

// Leagues is the part of the league sync store the account answer reads.
type Leagues interface {
	Context(ctx context.Context, accountID uuid.UUID) (LeagueContext, error)
}

// LeagueContext is the site's context for an account (founder ruling
// 2026-10-13): the selected league, every league it follows, and the
// format every page opens in.
type LeagueContext struct {
	League  *apitypes.ContextLeague
	Leagues []apitypes.ContextLeague
	Format  *apitypes.BoardFormat
}

// View is a's Account answer at now.
func (v *Viewer) View(ctx context.Context, a auth.Account) (apitypes.Account, error) {
	now := v.Now()
	features, err := v.Entitlements.Features(ctx, a.ID, now)
	if err != nil {
		return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
	}
	pass, err := v.Entitlements.LivePass(ctx, a.ID, now)
	if err != nil {
		return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
	}
	membership, err := v.Entitlements.AccountMembership(ctx, a.ID, now)
	if err != nil {
		return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
	}
	if features == nil {
		features = []entitlements.Feature{}
	}
	leagues := LeagueContext{Leagues: []apitypes.ContextLeague{}}
	if v.Leagues != nil {
		if leagues, err = v.Leagues.Context(ctx, a.ID); err != nil {
			return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
		}
	}
	var notifications *apitypes.NotificationSettings
	if v.Notifications != nil {
		settings, err := v.Notifications.Notifications(ctx, a.ID)
		if err != nil {
			return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
		}
		notifications = &settings
	}
	return apitypes.Account{
		Id: a.ID, Email: a.Email, FirstName: a.FirstName, LastName: a.LastName, Handle: a.Handle,
		Features: features, DraftPass: passView(pass), Membership: membershipView(membership),
		League: leagues.League, Leagues: leagues.Leagues, Format: leagues.Format, Season: siteSeason(ctx, v.Season),
		Notifications: notifications, CreatedAt: a.CreatedAt,
	}, nil
}

func passView(p *entitlements.Pass) *apitypes.DraftPassState {
	if p == nil {
		return nil
	}
	return &apitypes.DraftPassState{
		Season: p.Season, EndsAt: p.EndsAt, Source: apitypes.DraftPassStateSource(p.Source),
	}
}

func membershipView(m *entitlements.HeldMembership) *apitypes.MembershipState {
	if m == nil {
		return nil
	}
	out := &apitypes.MembershipState{
		Source: apitypes.MembershipStateSource(m.Source), Status: m.Status,
		StartsAt: m.StartsAt, EndsAt: m.EndsAt,
	}
	if m.Source != entitlements.SourceSubscription {
		// A grant bought nothing: no interval, no period, nothing to cancel.
		return out
	}
	cancel := m.CancelAtPeriodEnd
	out.CurrentPeriodEnd, out.CancelAtPeriodEnd = m.CurrentPeriodEnd, &cancel
	if m.Interval != nil {
		iv := apitypes.Interval(*m.Interval)
		out.Interval = &iv
	}
	return out
}
