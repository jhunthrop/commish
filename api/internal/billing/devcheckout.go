package billing

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/http/httptest"
	"time"

	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/jhunthrop/commish/api/internal/httpx"
)

// The development checkout: with BILLING_FAKE=true (refused in
// production by internal/config) the API sells through FakeGateway, and
// a checkout link opens this page instead of Stripe's. Paying here
// settles the session in the fake and delivers a signed
// checkout.session.completed to the real webhook handler, so every
// local walk goes through the same path a Stripe event takes. Nothing
// here is mounted unless the flag is on.

const (
	devCheckoutPath = "/billing/dev-checkout/"
	devPortalPath   = "/billing/dev-portal"
	devPerMinute    = 60
	// devPeriodYear and devPeriodMonth are a fake subscription's paid
	// period, by its price's interval.
	devPeriodYear  = 365 * 24 * time.Hour
	devPeriodMonth = 30 * 24 * time.Hour
	centsPerDollar = 100
)

// NewDevGateway is the development checkout's FakeGateway: every launch
// price present, links pointing back at this API. The second value is
// the webhook signing secret it signs with, random per process.
func NewDevGateway(apiBaseURL string) (*FakeGateway, string) {
	run := make([]byte, 4)
	_, _ = rand.Read(run)
	f := &FakeGateway{CheckoutBaseURL: apiBaseURL + devCheckoutPath, PortalURL: apiBaseURL + devPortalPath, Run: "_" + hex.EncodeToString(run)}
	for _, spec := range LaunchPrices() {
		_ = f.EnsurePrice(context.Background(), spec)
	}
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	return f, "whsec_dev_" + hex.EncodeToString(secret)
}

// DevRoutes are the development checkout's pages. fake is the gateway
// the service sells through.
func (s *Service) DevRoutes(fake *FakeGateway) []httpx.Route {
	d := devCheckout{service: s, fake: fake}
	return []httpx.Route{
		{Method: http.MethodGet, Path: devCheckoutPath + "{id}", Access: httpx.Public, Limit: httpx.PerMinute(devPerMinute), Handler: d.page},
		{Method: http.MethodGet, Path: devCheckoutPath + "{id}/pay", Access: httpx.Public, Limit: httpx.PerMinute(devPerMinute), Handler: d.pay},
		{Method: http.MethodGet, Path: devPortalPath, Access: httpx.Public, Limit: httpx.PerMinute(devPerMinute), Handler: d.portal},
	}
}

type devCheckout struct {
	service *Service
	fake    *FakeGateway
}

var devPage = template.Must(template.New("dev").Parse(`<!doctype html><meta charset="utf-8">
<title>Development checkout</title>
<body style="font:16px system-ui;max-width:32rem;margin:3rem auto">
<h1>Development checkout</h1>
<p>{{.Product}}, {{.Quantity}} at {{.Amount}}. No card is charged: this is the local fake.</p>
<p><a href="{{.Pay}}">Pay</a> &nbsp; <a href="{{.Cancel}}">Back without paying</a></p>`))

func (d devCheckout) page(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, ok := d.fake.opened(id)
	if !ok {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such checkout", nil)
		return
	}
	price := d.fake.priceByID(p.PriceID)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = devPage.Execute(w, map[string]any{
		"Product": p.Metadata[metaProduct], "Quantity": p.Quantity,
		"Amount": fmt.Sprintf("$%.2f each", float64(price.AmountCents)/centsPerDollar),
		"Pay":    devCheckoutPath + id + "/pay", "Cancel": p.CancelURL,
	})
}

func (d devCheckout) pay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := d.fake.settle(id, d.service.Now())
	if err != nil {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, err.Error(), nil)
		return
	}
	if code := d.deliver(r, id); code != http.StatusOK {
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeInternal, fmt.Sprintf("The webhook answered %d", code), nil)
		return
	}
	http.Redirect(w, r, p.SuccessURL, http.StatusSeeOther)
}

func (d devCheckout) portal(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, d.service.site(pathAccount), http.StatusSeeOther)
}

// deliver signs checkout.session.completed for the session and hands it
// to the webhook handler exactly as Stripe's delivery would arrive.
func (d devCheckout) deliver(r *http.Request, sessionID string) int {
	event, _ := json.Marshal(map[string]any{
		"id": "evt_dev_" + sessionID, "object": "event", "type": "checkout.session.completed",
		"api_version": stripe.APIVersion, "created": d.service.Now().Unix(),
		"data": map[string]any{"object": map[string]any{"id": sessionID, "object": "checkout.session"}},
	})
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: event, Secret: d.service.WebhookSecret})
	req := httptest.NewRequestWithContext(r.Context(), http.MethodPost, "/billing/webhook", bytes.NewReader(event))
	req.Header.Set("Stripe-Signature", signed.Header)
	rec := httptest.NewRecorder()
	d.service.webhook(rec, req)
	return rec.Code
}

func (f *FakeGateway) opened(id string) (CheckoutParams, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.Opened[id]
	return p, ok
}

func (f *FakeGateway) priceByID(priceID string) Price {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.Prices {
		if p.ID == priceID {
			return p
		}
	}
	return Price{}
}

// settle records the session as paid, with its payment and, for the
// Membership, a live subscription carrying the session's metadata, the
// way Stripe's checkout leaves them.
func (f *FakeGateway) settle(id string, now time.Time) (CheckoutParams, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.Opened[id]
	if !ok {
		return CheckoutParams{}, fmt.Errorf("no checkout %s", id)
	}
	sess := &stripe.CheckoutSession{
		ID: id, Mode: stripe.CheckoutSessionMode(p.Mode), PaymentStatus: stripe.CheckoutSessionPaymentStatusPaid,
		Metadata: p.Metadata, PaymentIntent: &stripe.PaymentIntent{ID: "pi_" + id},
	}
	if p.Mode == ModeSubscription {
		sess.PaymentIntent = nil
		sess.Subscription = f.subscriptionFor(id, p, now)
	}
	if f.Sessions == nil {
		f.Sessions = map[string]*stripe.CheckoutSession{}
	}
	f.Sessions[id] = sess
	return p, nil
}

func (f *FakeGateway) subscriptionFor(id string, p CheckoutParams, now time.Time) *stripe.Subscription {
	interval := stripe.PriceRecurringIntervalYear
	period := devPeriodYear
	for _, price := range f.Prices {
		if price.ID == p.PriceID && price.Interval == string(stripe.PriceRecurringIntervalMonth) {
			interval, period = stripe.PriceRecurringIntervalMonth, devPeriodMonth
		}
	}
	sub := &stripe.Subscription{
		ID: "sub_" + id, Status: stripe.SubscriptionStatusActive, Metadata: p.Metadata,
		Items: &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{{
			CurrentPeriodEnd: now.Add(period).Unix(),
			Price:            &stripe.Price{Recurring: &stripe.PriceRecurring{Interval: interval}},
		}}},
	}
	if f.Subscriptions == nil {
		f.Subscriptions = map[string]*stripe.Subscription{}
	}
	f.Subscriptions[sub.ID] = sub
	return sub
}
