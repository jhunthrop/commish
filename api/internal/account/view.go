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
)

// Entitlements is the part of entitlements.Store the view reads.
type Entitlements interface {
	Features(ctx context.Context, accountID uuid.UUID, now time.Time) ([]entitlements.Feature, error)
	LivePass(ctx context.Context, accountID uuid.UUID, now time.Time) (*entitlements.Pass, error)
	LatestMembership(ctx context.Context, accountID uuid.UUID) (*entitlements.Membership, error)
}

// Viewer builds Account answers.
type Viewer struct {
	Entitlements Entitlements
	// Leagues answers the account's newest attached league, for the
	// rail's League item. Nil answers none.
	Leagues Leagues
	Now     func() time.Time
}

// Leagues is the part of the league sync store the account answer reads.
type Leagues interface {
	Newest(ctx context.Context, accountID uuid.UUID) (*uuid.UUID, error)
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
	membership, err := v.Entitlements.LatestMembership(ctx, a.ID)
	if err != nil {
		return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
	}
	if features == nil {
		features = []entitlements.Feature{}
	}
	var league *uuid.UUID
	if v.Leagues != nil {
		if league, err = v.Leagues.Newest(ctx, a.ID); err != nil {
			return apitypes.Account{}, fmt.Errorf("account: view %s: %w", a.ID, err)
		}
	}
	return apitypes.Account{
		Id: a.ID, Email: a.Email, FirstName: a.FirstName, LastName: a.LastName, Handle: a.Handle,
		Features: features, DraftPass: passView(pass), Membership: membershipView(membership),
		LeagueId: league, CreatedAt: a.CreatedAt,
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

func membershipView(m *entitlements.Membership) *apitypes.MembershipState {
	if m == nil {
		return nil
	}
	out := &apitypes.MembershipState{
		Status: m.Status, CurrentPeriodEnd: m.CurrentPeriodEnd, CancelAtPeriodEnd: m.CancelAtPeriodEnd,
	}
	if m.Interval != nil {
		iv := apitypes.Interval(*m.Interval)
		out.Interval = &iv
	}
	return out
}
