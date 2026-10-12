package billing

import (
	"context"
	"fmt"
	"sync"
	"time"

	stripe "github.com/stripe/stripe-go/v82"
)

// FakeGateway is the in-memory Gateway every test uses, so no test
// ever reaches Stripe. The zero value is usable; a test fills the
// exported maps before exercising a handler and reads the recorded
// calls after.
type FakeGateway struct {
	mu sync.Mutex

	// Err, when set, is every method's answer.
	Err error

	Sessions      map[string]*stripe.CheckoutSession
	Subscriptions map[string]*stripe.Subscription
	Prices        map[string]Price

	Customers []string
	Checkouts []CheckoutParams
	Canceled  map[string]bool

	next int
}

func (f *FakeGateway) id(prefix string) string {
	f.next++
	return fmt.Sprintf("%s_fake_%d", prefix, f.next)
}

func (f *FakeGateway) CreateCustomer(_ context.Context, email, _ string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return "", f.Err
	}
	f.Customers = append(f.Customers, email)
	return f.id("cus"), nil
}

func (f *FakeGateway) CreateCheckout(_ context.Context, p CheckoutParams) (CheckoutSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return CheckoutSession{}, f.Err
	}
	f.Checkouts = append(f.Checkouts, p)
	id := f.id("cs")
	return CheckoutSession{ID: id, URL: "https://checkout.stripe.test/" + id, ExpiresAt: time.Now().Add(24 * time.Hour)}, nil
}

func (f *FakeGateway) CreatePortal(_ context.Context, customerID, _ string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return "", f.Err
	}
	return "https://billing.stripe.test/" + customerID, nil
}

func (f *FakeGateway) GetCheckoutSession(_ context.Context, id string) (*stripe.CheckoutSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	if s, ok := f.Sessions[id]; ok {
		return s, nil
	}
	return nil, fmt.Errorf("billing: fake: no checkout session %s", id)
}

func (f *FakeGateway) GetSubscription(_ context.Context, id string) (*stripe.Subscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	if s, ok := f.Subscriptions[id]; ok {
		return s, nil
	}
	return nil, fmt.Errorf("billing: fake: no subscription %s", id)
}

func (f *FakeGateway) SetCancelAtPeriodEnd(_ context.Context, subscriptionID string, cancel bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	if f.Canceled == nil {
		f.Canceled = map[string]bool{}
	}
	f.Canceled[subscriptionID] = cancel
	if s, ok := f.Subscriptions[subscriptionID]; ok {
		s.CancelAtPeriodEnd = cancel
	}
	return nil
}

func (f *FakeGateway) Price(_ context.Context, lookupKey string) (Price, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return Price{}, f.Err
	}
	if p, ok := f.Prices[lookupKey]; ok {
		return p, nil
	}
	return Price{}, ErrPriceNotFound
}

func (f *FakeGateway) EnsurePrice(_ context.Context, spec PriceSpec) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	if f.Prices == nil {
		f.Prices = map[string]Price{}
	}
	if _, ok := f.Prices[spec.LookupKey]; !ok {
		f.Prices[spec.LookupKey] = Price{ID: "price_fake_" + spec.LookupKey, LookupKey: spec.LookupKey,
			AmountCents: spec.AmountCents, Currency: "usd", Interval: spec.Interval}
	}
	return nil
}
