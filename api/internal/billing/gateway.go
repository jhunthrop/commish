// Package billing is Stripe: checkout for the Draft Pass, the
// Membership and the Group Draft Pass, the customer portal, one-click
// cancellation, the webhook, the nightly reconcile and the renewal
// reminder (spec §2.6). It never writes app.entitlements directly; every
// grant goes through internal/entitlements, which stays the only writer.
package billing

import (
	"context"
	"errors"
	"time"

	stripe "github.com/stripe/stripe-go/v82"
)

// Lookup keys, the only Stripe price identifiers the code names. A
// price is resolved from its key at request time, so repricing is a new
// price under the same key in Stripe, never a deploy.
const (
	LookupDraftPass         = "draft_pass_season"
	LookupMembershipYearly  = "membership_yearly"
	LookupMembershipMonthly = "membership_monthly"
	LookupGroupPassSeat     = "group_pass_seat"
)

// Product ids, fixed so stripe-setup and the reconcile agree on them.
const (
	ProductIDDraftPass  = "prod_commish_draft_pass"
	ProductIDMembership = "prod_commish_membership"
	ProductIDGroupPass  = "prod_commish_group_pass"
)

// Metadata keys set on every checkout session, its payment intent and
// its subscription, so every later event can be tied back to the
// account and the product without trusting the event's own snapshot.
const (
	metaAccountID  = "account_id"
	metaProduct    = "product"
	metaSeason     = "season"
	metaSeats      = "seats"
	metaLeagueName = "league_name"
)

// ErrPriceNotFound is a lookup key with no active price yet.
var ErrPriceNotFound = errors.New("billing: no active price for that lookup key")

// Mode is a checkout's kind: a one-time payment or a subscription.
type Mode string

const (
	ModePayment      Mode = "payment"
	ModeSubscription Mode = "subscription"
)

// CheckoutParams is one checkout session to create.
type CheckoutParams struct {
	Mode       Mode
	CustomerID string
	PriceID    string
	Quantity   int64
	Metadata   map[string]string
	SuccessURL string
	CancelURL  string
}

// CheckoutSession is what creating one returns.
type CheckoutSession struct {
	ID        string
	URL       string
	ExpiresAt time.Time
}

// Price is one active price.
type Price struct {
	ID          string
	LookupKey   string
	AmountCents int64
	Currency    string
	// Interval is "year" or "month" for a recurring price, empty for a
	// one-time one.
	Interval string
}

// launchCurrency is the launch prices' currency, as Stripe writes it.
const launchCurrency = "usd"

// Launch prices in cents. The seat is the provisional Lane 8 ruling:
// $29 a team, at least eight teams.
const (
	centsDraftPass         = 3900
	centsMembershipYearly  = 9900
	centsMembershipMonthly = 1499
	centsGroupPassSeat     = 2900
)

// LaunchPrices are the products and prices stripe-setup makes sure
// exist, and the ones the development fake checkout sells.
func LaunchPrices() []PriceSpec {
	return []PriceSpec{
		{ProductID: ProductIDDraftPass, ProductName: "Commish Draft Pass", LookupKey: LookupDraftPass, AmountCents: centsDraftPass},
		{ProductID: ProductIDMembership, ProductName: "Commish Membership", LookupKey: LookupMembershipYearly, AmountCents: centsMembershipYearly, Interval: "year"},
		{ProductID: ProductIDMembership, ProductName: "Commish Membership", LookupKey: LookupMembershipMonthly, AmountCents: centsMembershipMonthly, Interval: "month"},
		{ProductID: ProductIDGroupPass, ProductName: "Commish Group Draft Pass", LookupKey: LookupGroupPassSeat, AmountCents: centsGroupPassSeat},
	}
}

// PriceSpec is a product and price stripe-setup makes sure exist.
type PriceSpec struct {
	ProductID   string
	ProductName string
	LookupKey   string
	AmountCents int64
	// Interval is empty for a one-time price.
	Interval string
}

// Gateway is every Stripe call this package makes. StripeGateway is the
// real one; FakeGateway is the in-memory one every test uses, so no test
// ever reaches Stripe.
type Gateway interface {
	CreateCustomer(ctx context.Context, email, accountID string) (string, error)
	CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutSession, error)
	CreatePortal(ctx context.Context, customerID, returnURL string) (string, error)
	// GetCheckoutSession and GetSubscription re-fetch fresh, the one
	// read every webhook makes instead of trusting the event's payload.
	GetCheckoutSession(ctx context.Context, id string) (*stripe.CheckoutSession, error)
	GetSubscription(ctx context.Context, id string) (*stripe.Subscription, error)
	SetCancelAtPeriodEnd(ctx context.Context, subscriptionID string, cancel bool) error
	// CancelSubscriptionNow ends a subscription at once, for a dispute.
	CancelSubscriptionNow(ctx context.Context, subscriptionID string) error
	// ExpireCheckout closes an open checkout session so it can no
	// longer be paid.
	ExpireCheckout(ctx context.Context, sessionID string) error
	// RefundDuplicate refunds a payment in full as a duplicate, once:
	// a retried call with the same payment is the same refund.
	RefundDuplicate(ctx context.Context, paymentIntentID string) error
	// SubscriptionForPayment is the subscription an invoice payment
	// belongs to, empty when the payment was not a subscription's.
	SubscriptionForPayment(ctx context.Context, paymentIntentID string) (string, error)
	Price(ctx context.Context, lookupKey string) (Price, error)
	EnsurePrice(ctx context.Context, spec PriceSpec) error
}
