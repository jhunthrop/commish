package billing

import (
	"context"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// plansMaxAge is how long a browser and the edge keep the catalog: a
// repricing in Stripe reaches the pass page within five minutes.
const plansMaxAge = "public, max-age=300"

// plans is the pass page's catalog: what each product unlocks, always,
// and its price from Stripe once checkout is open. The page never holds
// a price of its own.
func (s *Service) plans(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	features, err := s.planFeatures(ctx)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: plan features", err)
		return
	}
	out := apitypes.PlanCatalog{
		Season: season.Of(s.Now()), CheckoutOpen: s.Gateway != nil, Features: features, Membership: []apitypes.Price{},
	}
	if s.Gateway != nil {
		if err := s.planPrices(ctx, &out); err != nil {
			httpx.WriteInternal(w, r, s.Log, "billing: plans", err)
			return
		}
	}
	w.Header().Set("Cache-Control", plansMaxAge)
	httpx.WriteOK(w, r, http.StatusOK, out)
}

func (s *Service) planFeatures(ctx context.Context) (apitypes.PlanFeatures, error) {
	byProduct, err := s.Catalog.ProductFeatures(ctx)
	if err != nil {
		return apitypes.PlanFeatures{}, err
	}
	orEmpty := func(p entitlements.Product) []apitypes.Feature {
		if f := byProduct[p]; f != nil {
			return f
		}
		return []apitypes.Feature{}
	}
	return apitypes.PlanFeatures{
		DraftPass: orEmpty(entitlements.ProductDraftPass), Membership: orEmpty(entitlements.ProductMembership),
	}, nil
}

// planPrices fills each product's price by its lookup key, a product
// with no price yet staying null.
func (s *Service) planPrices(ctx context.Context, out *apitypes.PlanCatalog) error {
	var err error
	if out.DraftPass, err = s.lookupPrice(ctx, LookupDraftPass); err != nil {
		return err
	}
	// Annual first, always (spec §2.6).
	for _, key := range []string{LookupMembershipYearly, LookupMembershipMonthly} {
		p, err := s.lookupPrice(ctx, key)
		if err != nil {
			return err
		}
		if p != nil {
			out.Membership = append(out.Membership, *p)
		}
	}
	seat, err := s.lookupPrice(ctx, LookupGroupPassSeat)
	if err != nil {
		return err
	}
	if seat != nil {
		out.GroupPass = &apitypes.GroupPassPrice{PerSeat: *seat, MinSeats: MinGroupSeats, MaxSeats: MaxGroupSeats}
	}
	return nil
}
