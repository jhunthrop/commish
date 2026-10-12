package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// errRefused carries a 409's message out of the checkout lock.
type errRefused struct{ msg string }

func (e errRefused) Error() string { return e.msg }

func (s *Service) plans(w http.ResponseWriter, r *http.Request) {
	if !s.available(w, r) {
		return
	}
	ctx := r.Context()
	out := apitypes.PlanCatalog{Season: season.Of(s.Now()), Membership: []apitypes.Price{}}
	var err error
	if out.DraftPass, err = s.lookupPrice(ctx, LookupDraftPass); err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: plans", err)
		return
	}
	// Annual first, always (spec §2.6).
	for _, key := range []string{LookupMembershipYearly, LookupMembershipMonthly} {
		p, err := s.lookupPrice(ctx, key)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "billing: plans", err)
			return
		}
		if p != nil {
			out.Membership = append(out.Membership, *p)
		}
	}
	seat, err := s.lookupPrice(ctx, LookupGroupPassSeat)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: plans", err)
		return
	}
	if seat != nil {
		out.GroupPass = &apitypes.GroupPassPrice{PerSeat: *seat, MinSeats: MinGroupSeats, MaxSeats: MaxGroupSeats}
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// checkoutPlan is a validated request: what to sell and how.
type checkoutPlan struct {
	mode      Mode
	lookupKey string
	quantity  int64
	meta      map[string]string
}

// plan validates the request into a checkoutPlan, or the fields at
// fault.
func (s *Service) plan(a auth.Account, in apitypes.CheckoutRequest) (checkoutPlan, map[string]string) {
	meta := map[string]string{metaAccountID: a.ID.String(), metaProduct: string(in.Product)}
	yr := season.Of(s.Now())
	switch in.Product {
	case apitypes.ProductDraftPass:
		meta[metaSeason] = strconv.Itoa(yr)
		return checkoutPlan{mode: ModePayment, lookupKey: LookupDraftPass, quantity: 1, meta: meta}, nil
	case apitypes.ProductMembership:
		key := LookupMembershipYearly
		if in.Interval != nil && *in.Interval == apitypes.IntervalMonth {
			key = LookupMembershipMonthly
		} else if in.Interval != nil && *in.Interval != apitypes.IntervalYear {
			return checkoutPlan{}, map[string]string{"interval": "Pick year or month"}
		}
		return checkoutPlan{mode: ModeSubscription, lookupKey: key, quantity: 1, meta: meta}, nil
	case apitypes.ProductGroupPass:
		errs := map[string]string{}
		if in.Seats == nil || *in.Seats < MinGroupSeats || *in.Seats > MaxGroupSeats {
			errs["seats"] = fmt.Sprintf("Pick %d to %d passes", MinGroupSeats, MaxGroupSeats)
		}
		if in.LeagueName == nil || utf8.RuneCountInString(*in.LeagueName) < 1 || utf8.RuneCountInString(*in.LeagueName) > 60 {
			errs["league_name"] = "Name the league in 1 to 60 characters"
		}
		if len(errs) > 0 {
			return checkoutPlan{}, errs
		}
		meta[metaSeason] = strconv.Itoa(yr)
		meta[metaSeats] = strconv.Itoa(*in.Seats)
		meta[metaLeagueName] = *in.LeagueName
		return checkoutPlan{mode: ModePayment, lookupKey: LookupGroupPassSeat, quantity: int64(*in.Seats), meta: meta}, nil
	default:
		return checkoutPlan{}, map[string]string{"product": "Pick the Draft Pass, the Membership or the Group Draft Pass"}
	}
}

// refuseDuplicate stops a second purchase of what the account already
// has: a second pass for the season, a pass on top of a Membership, a
// second Membership.
func (s *Service) refuseDuplicate(ctx context.Context, a auth.Account, product apitypes.Product) error {
	if product == apitypes.ProductGroupPass {
		return nil
	}
	now := s.Now()
	m, err := s.Entitlements.LiveMembership(ctx, a.ID, now)
	if err != nil {
		return err
	}
	if m != nil {
		return errRefused{"Your Membership already includes this"}
	}
	if product == apitypes.ProductDraftPass {
		has, err := s.Entitlements.HasLivePass(ctx, a.ID, season.Of(now), now)
		if err != nil {
			return err
		}
		if has {
			return errRefused{"You already have this season's Draft Pass"}
		}
	}
	return nil
}

// customer is the account's Stripe customer, made on first checkout.
func (s *Service) customer(ctx context.Context, a auth.Account) (string, error) {
	id, ok, err := s.Store.CustomerID(ctx, a.ID)
	if err != nil || ok {
		return id, err
	}
	id, err = s.Gateway.CreateCustomer(ctx, a.Email, a.ID.String())
	if err != nil {
		return "", err
	}
	return id, s.Store.SaveCustomerID(ctx, a.ID, id)
}

func (s *Service) checkout(w http.ResponseWriter, r *http.Request) {
	if !s.available(w, r) {
		return
	}
	var in apitypes.CheckoutRequest
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	a, _ := auth.AccountFrom(r.Context())
	p, errs := s.plan(a, in)
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	var session CheckoutSession
	// One checkout at a time per account, so a double click cannot slip
	// two purchases past the duplicate check.
	err := s.Store.WithLock(r.Context(), "checkout:"+a.ID.String(), func(ctx context.Context) error {
		if err := s.refuseDuplicate(ctx, a, in.Product); err != nil {
			return err
		}
		price, err := s.Gateway.Price(ctx, p.lookupKey)
		if err != nil {
			return err
		}
		customerID, err := s.customer(ctx, a)
		if err != nil {
			return err
		}
		session, err = s.Gateway.CreateCheckout(ctx, CheckoutParams{
			Mode: p.mode, CustomerID: customerID, PriceID: price.ID, Quantity: p.quantity, Metadata: p.meta,
			SuccessURL: s.site(pathCheckoutDone), CancelURL: s.site(pathCheckoutCanceled),
		})
		return err
	})
	var refused errRefused
	switch {
	case errors.As(err, &refused):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, refused.msg, nil)
	case errors.Is(err, ErrPriceNotFound):
		writeUnavailable(w, r)
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "billing: checkout", err)
	default:
		httpx.WriteOK(w, r, http.StatusOK, apitypes.Redirect{Url: session.URL})
	}
}
