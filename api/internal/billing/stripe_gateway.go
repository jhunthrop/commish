package billing

import (
	"context"
	"fmt"
	"sync"
	"time"

	stripe "github.com/stripe/stripe-go/v82"
)

// priceCacheTTL is how long a resolved price is reused in-process:
// prices change only when someone deliberately reprices.
const priceCacheTTL = 5 * time.Minute

type cachedPrice struct {
	price     Price
	expiresAt time.Time
}

// StripeGateway is the real Gateway. It is never built in a test.
type StripeGateway struct {
	client       *stripe.Client
	automaticTax bool

	mu    sync.Mutex
	cache map[string]cachedPrice
}

// NewStripeGateway binds a gateway to secretKey, test or live as
// config already checked. automaticTax turns on Stripe Tax at checkout.
func NewStripeGateway(secretKey string, automaticTax bool) *StripeGateway {
	return &StripeGateway{client: stripe.NewClient(secretKey), automaticTax: automaticTax, cache: map[string]cachedPrice{}}
}

func (g *StripeGateway) CreateCustomer(ctx context.Context, email, accountID string) (string, error) {
	c, err := g.client.V1Customers.Create(ctx, &stripe.CustomerCreateParams{
		Email: stripe.String(email), Metadata: map[string]string{metaAccountID: accountID},
	})
	if err != nil {
		return "", fmt.Errorf("billing: create customer: %w", err)
	}
	return c.ID, nil
}

func (g *StripeGateway) CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutSession, error) {
	params := &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(p.Mode)),
		Customer:          stripe.String(p.CustomerID),
		ClientReferenceID: stripe.String(p.Metadata[metaAccountID]),
		Metadata:          p.Metadata,
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(p.PriceID), Quantity: stripe.Int64(p.Quantity)},
		},
		AllowPromotionCodes: stripe.Bool(true),
		SuccessURL:          stripe.String(p.SuccessURL),
		CancelURL:           stripe.String(p.CancelURL),
	}
	if g.automaticTax {
		params.AutomaticTax = &stripe.CheckoutSessionCreateAutomaticTaxParams{Enabled: stripe.Bool(true)}
		// Stripe Tax needs the buyer's address on the customer.
		params.CustomerUpdate = &stripe.CheckoutSessionCreateCustomerUpdateParams{Address: stripe.String("auto")}
	}
	if p.Mode == ModeSubscription {
		params.SubscriptionData = &stripe.CheckoutSessionCreateSubscriptionDataParams{Metadata: p.Metadata}
	} else {
		params.PaymentIntentData = &stripe.CheckoutSessionCreatePaymentIntentDataParams{Metadata: p.Metadata}
	}
	sess, err := g.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return CheckoutSession{}, fmt.Errorf("billing: create checkout: %w", err)
	}
	return CheckoutSession{ID: sess.ID, URL: sess.URL, ExpiresAt: time.Unix(sess.ExpiresAt, 0).UTC()}, nil
}

func (g *StripeGateway) CreatePortal(ctx context.Context, customerID, returnURL string) (string, error) {
	sess, err := g.client.V1BillingPortalSessions.Create(ctx, &stripe.BillingPortalSessionCreateParams{
		Customer: stripe.String(customerID), ReturnURL: stripe.String(returnURL),
	})
	if err != nil {
		return "", fmt.Errorf("billing: create portal: %w", err)
	}
	return sess.URL, nil
}

func (g *StripeGateway) GetCheckoutSession(ctx context.Context, id string) (*stripe.CheckoutSession, error) {
	sess, err := g.client.V1CheckoutSessions.Retrieve(ctx, id, nil)
	if err != nil {
		return nil, fmt.Errorf("billing: get checkout session %s: %w", id, err)
	}
	return sess, nil
}

func (g *StripeGateway) GetSubscription(ctx context.Context, id string) (*stripe.Subscription, error) {
	sub, err := g.client.V1Subscriptions.Retrieve(ctx, id, nil)
	if err != nil {
		return nil, fmt.Errorf("billing: get subscription %s: %w", id, err)
	}
	return sub, nil
}

func (g *StripeGateway) SetCancelAtPeriodEnd(ctx context.Context, subscriptionID string, cancel bool) error {
	if _, err := g.client.V1Subscriptions.Update(ctx, subscriptionID, &stripe.SubscriptionUpdateParams{
		CancelAtPeriodEnd: stripe.Bool(cancel),
	}); err != nil {
		return fmt.Errorf("billing: set cancel at period end %s: %w", subscriptionID, err)
	}
	return nil
}

func (g *StripeGateway) CancelSubscriptionNow(ctx context.Context, subscriptionID string) error {
	if _, err := g.client.V1Subscriptions.Cancel(ctx, subscriptionID, nil); err != nil {
		return fmt.Errorf("billing: cancel subscription %s: %w", subscriptionID, err)
	}
	return nil
}

func (g *StripeGateway) ExpireCheckout(ctx context.Context, sessionID string) error {
	if _, err := g.client.V1CheckoutSessions.Expire(ctx, sessionID, nil); err != nil {
		return fmt.Errorf("billing: expire checkout %s: %w", sessionID, err)
	}
	return nil
}

func (g *StripeGateway) RefundDuplicate(ctx context.Context, paymentIntentID string) error {
	params := &stripe.RefundCreateParams{
		PaymentIntent: stripe.String(paymentIntentID), Reason: stripe.String(string(stripe.RefundReasonDuplicate)),
	}
	params.SetIdempotencyKey("refund-duplicate-" + paymentIntentID)
	if _, err := g.client.V1Refunds.Create(ctx, params); err != nil {
		return fmt.Errorf("billing: refund %s: %w", paymentIntentID, err)
	}
	return nil
}

func (g *StripeGateway) SubscriptionForPayment(ctx context.Context, paymentIntentID string) (string, error) {
	params := &stripe.InvoicePaymentListParams{Payment: &stripe.InvoicePaymentListPaymentParams{
		Type: stripe.String("payment_intent"), PaymentIntent: stripe.String(paymentIntentID),
	}}
	params.AddExpand("data.invoice")
	for p, err := range g.client.V1InvoicePayments.List(ctx, params) {
		if err != nil {
			return "", fmt.Errorf("billing: invoice payment for %s: %w", paymentIntentID, err)
		}
		inv := p.Invoice
		if inv != nil && inv.Parent != nil && inv.Parent.SubscriptionDetails != nil && inv.Parent.SubscriptionDetails.Subscription != nil {
			return inv.Parent.SubscriptionDetails.Subscription.ID, nil
		}
	}
	return "", nil
}

func priceFrom(p *stripe.Price) Price {
	out := Price{ID: p.ID, LookupKey: p.LookupKey, AmountCents: p.UnitAmount, Currency: string(p.Currency)}
	if p.Recurring != nil {
		out.Interval = string(p.Recurring.Interval)
	}
	return out
}

func (g *StripeGateway) Price(ctx context.Context, lookupKey string) (Price, error) {
	g.mu.Lock()
	if c, ok := g.cache[lookupKey]; ok && time.Now().Before(c.expiresAt) {
		g.mu.Unlock()
		return c.price, nil
	}
	g.mu.Unlock()
	for p, err := range g.client.V1Prices.List(ctx, &stripe.PriceListParams{
		LookupKeys: []*string{stripe.String(lookupKey)}, Active: stripe.Bool(true),
	}) {
		if err != nil {
			return Price{}, fmt.Errorf("billing: price %s: %w", lookupKey, err)
		}
		out := priceFrom(p)
		g.mu.Lock()
		g.cache[lookupKey] = cachedPrice{price: out, expiresAt: time.Now().Add(priceCacheTTL)}
		g.mu.Unlock()
		return out, nil
	}
	return Price{}, ErrPriceNotFound
}

// EnsurePrice creates the product and price when the lookup key has no
// active price, and never changes an existing price.
func (g *StripeGateway) EnsurePrice(ctx context.Context, spec PriceSpec) error {
	if _, err := g.Price(ctx, spec.LookupKey); err == nil {
		return nil
	} else if err != ErrPriceNotFound {
		return err
	}
	if _, err := g.client.V1Products.Retrieve(ctx, spec.ProductID, nil); err != nil {
		if _, cerr := g.client.V1Products.Create(ctx, &stripe.ProductCreateParams{
			ID: stripe.String(spec.ProductID), Name: stripe.String(spec.ProductName),
		}); cerr != nil {
			return fmt.Errorf("billing: create product %s: %w", spec.ProductID, cerr)
		}
	}
	params := &stripe.PriceCreateParams{
		Product: stripe.String(spec.ProductID), Currency: stripe.String("usd"),
		UnitAmount: stripe.Int64(spec.AmountCents), LookupKey: stripe.String(spec.LookupKey),
		TaxBehavior: stripe.String("exclusive"),
	}
	if spec.Interval != "" {
		params.Recurring = &stripe.PriceCreateRecurringParams{Interval: stripe.String(spec.Interval)}
	}
	if _, err := g.client.V1Prices.Create(ctx, params); err != nil {
		return fmt.Errorf("billing: create price %s: %w", spec.LookupKey, err)
	}
	return nil
}
