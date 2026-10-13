package billing

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// Group pass seat bounds: one pass per team in a league, so the
// league's own team bounds, matching app.group_passes' check.
const (
	MinGroupSeats = leagues.MinTeams
	MaxGroupSeats = leagues.MaxTeams
)

// Where checkout returns the browser on the site (Lane 8's pages). The
// done page is told what was bought (&bought=draft_pass), so it knows
// what to wait for while the webhook lands.
const (
	pathCheckoutDone     = "/account?checkout=done"
	pathCheckoutCanceled = "/pass?checkout=canceled"
	pathAccount          = "/account"
	pathClaim            = "/claim/"
)

// Rate limits. Checkout and the portal mint Stripe sessions, so they are
// budgeted by the hour; the webhook is Stripe's own retry pace.
const (
	limitCheckoutPerHour  = 20
	limitManagePerHour    = 20
	limitPlansPerMinute   = 120
	limitWebhookPerMinute = 600
	limitClaimPerHour     = 20
	limitPreviewPerMinute = 60
	limitReadPerMinute    = 120
)

// Entitlements is the part of entitlements.Store billing reads and
// writes through. It is the only path to app.entitlements.
type Entitlements interface {
	HasLivePass(ctx context.Context, accountID uuid.UUID, season int, now time.Time) (bool, error)
	LiveMembership(ctx context.Context, accountID uuid.UUID, now time.Time) (*entitlements.Membership, error)
	GrantPass(ctx context.Context, g entitlements.PassGrant) (bool, error)
	UpsertSubscription(ctx context.Context, st entitlements.SubscriptionState) error
	OtherLiveSubscription(ctx context.Context, accountID uuid.UUID, subscriptionID string, now time.Time) (string, error)
	SetCancelAtPeriodEnd(ctx context.Context, subscriptionID string, cancel bool, actor string) error
	HasOtherLivePass(ctx context.Context, accountID uuid.UUID, season int, checkoutSessionID string, now time.Time) (bool, error)
	EndPayment(ctx context.Context, paymentIntentID string, why entitlements.Ending, actor string) (int64, error)
	RestorePayment(ctx context.Context, paymentIntentID, actor string) (int64, error)
	EndSubscription(ctx context.Context, subscriptionID string, why entitlements.Ending, now time.Time, actor string) error
	ClaimGroupPass(ctx context.Context, groupPassID, accountID uuid.UUID, now time.Time, actor string) error
	LiveSubscriptionIDs(ctx context.Context) ([]string, error)
}

// BillingStore is the part of Store the service reads and writes:
// customers, the event log, checkout sessions, group passes and locks.
type BillingStore interface {
	CustomerID(ctx context.Context, accountID uuid.UUID) (string, bool, error)
	SaveCustomerID(ctx context.Context, accountID uuid.UUID, customerID string) error
	RecordEventOnce(ctx context.Context, id, eventType string, payload []byte) (bool, error)
	MarkEventProcessed(ctx context.Context, id string, o Outcome) error
	WithLock(ctx context.Context, key string, fn func(context.Context) error) error
	OpenCheckoutFor(ctx context.Context, accountID uuid.UUID, product string, seasonKey int, now time.Time) (*OpenCheckout, error)
	RecordCheckout(ctx context.Context, accountID uuid.UUID, product string, seasonKey int, lookupKey string, quantity int64, cs CheckoutSession) error
	CloseCheckout(ctx context.Context, sessionID, status string) error
	CreateGroupPass(ctx context.Context, g NewGroupPass) error
	GroupPassByCode(ctx context.Context, code string) (GroupPass, error)
	GroupPassesBoughtBy(ctx context.Context, accountID uuid.UUID) ([]GroupPass, error)
	GroupPassClaims(ctx context.Context, groupPassIDs []uuid.UUID) (map[uuid.UUID][]Claim, error)
	ClaimedBy(ctx context.Context, groupPassID, accountID uuid.UUID) (bool, error)
}

// ProductCatalog is what each product unlocks, the rows Can joins
// through. *entitlements.Store implements it.
type ProductCatalog interface {
	ProductFeatures(ctx context.Context) (map[entitlements.Product][]entitlements.Feature, error)
}

// SaleSeason is the one rule for which season a pass bought now is for.
// *season.Sale implements it.
type SaleSeason interface {
	Season(ctx context.Context, t time.Time) int
}

// HandleReader reads an account's public handle.
type HandleReader interface {
	HandleOf(ctx context.Context, id uuid.UUID) (*string, error)
}

// Service serves every billing route.
type Service struct {
	Store        BillingStore
	Entitlements Entitlements
	// Gateway is nil when Stripe is not configured; every route then
	// answers 503 rather than the API refusing to start.
	Gateway       Gateway
	WebhookSecret string
	Viewer        auth.AccountViewer
	Handles       HandleReader
	Catalog       ProductCatalog
	Sale          SaleSeason
	PublicBaseURL string
	Now           func() time.Time
	Log           *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/billing/plans", Access: httpx.Public, Limit: httpx.PerMinute(limitPlansPerMinute), Handler: s.plans},
		{Method: http.MethodPost, Path: "/billing/checkout", Access: httpx.SignedIn, Limit: httpx.PerHour(limitCheckoutPerHour), Handler: s.checkout},
		{Method: http.MethodPost, Path: "/billing/portal", Access: httpx.SignedIn, Limit: httpx.PerHour(limitManagePerHour), Handler: s.portal},
		{Method: http.MethodPost, Path: "/billing/membership/cancel", Access: httpx.SignedIn, Limit: httpx.PerHour(limitManagePerHour), Handler: s.cancel},
		{Method: http.MethodPost, Path: "/billing/membership/resume", Access: httpx.SignedIn, Limit: httpx.PerHour(limitManagePerHour), Handler: s.resume},
		{Method: http.MethodPost, Path: "/billing/webhook", Access: httpx.Webhook, Limit: httpx.PerMinute(limitWebhookPerMinute), Handler: s.webhook},
		{Method: http.MethodGet, Path: "/billing/group-passes", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.listGroupPasses},
		{Method: http.MethodGet, Path: "/group-passes/{code}", Access: httpx.Public, Limit: httpx.PerMinute(limitPreviewPerMinute), Handler: s.previewGroupPass},
		{Method: http.MethodPost, Path: "/group-passes/{code}/claim", Access: httpx.SignedIn, Limit: httpx.PerHour(limitClaimPerHour), Handler: s.claimGroupPass},
	}
}

func writeUnavailable(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeBillingUnavailable, "Checkout is not open yet", nil)
}

func (s *Service) available(w http.ResponseWriter, r *http.Request) bool {
	if s.Gateway == nil {
		writeUnavailable(w, r)
		return false
	}
	return true
}

func (s *Service) site(path string) string { return s.PublicBaseURL + path }

func (s *Service) writeAccount(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.AccountFrom(r.Context())
	view, err := s.Viewer.View(r.Context(), a)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: view account", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, view)
}

func (s *Service) portal(w http.ResponseWriter, r *http.Request) {
	if !s.available(w, r) {
		return
	}
	customerID, ok, err := s.Store.CustomerID(r.Context(), auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: portal", err)
		return
	}
	if !ok {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "Nothing has been bought on this account yet", nil)
		return
	}
	url, err := s.Gateway.CreatePortal(r.Context(), customerID, s.site(pathAccount))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: portal", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.Redirect{Url: url})
}

// setCancel is one-click cancellation and its undoing: Stripe first,
// then the row, so the account page shows it at once and the webhook
// that follows only confirms it.
func (s *Service) setCancel(w http.ResponseWriter, r *http.Request, cancel bool) {
	if !s.available(w, r) {
		return
	}
	m, err := s.Entitlements.LiveMembership(r.Context(), auth.AccountID(r), s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: membership", err)
		return
	}
	if m == nil {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "There is no Membership on this account", nil)
		return
	}
	if m.CancelAtPeriodEnd != cancel {
		if err := s.Gateway.SetCancelAtPeriodEnd(r.Context(), m.SubscriptionID, cancel); err != nil {
			httpx.WriteInternal(w, r, s.Log, "billing: set cancel", err)
			return
		}
		actor := "account:" + auth.AccountID(r).String()
		if err := s.Entitlements.SetCancelAtPeriodEnd(r.Context(), m.SubscriptionID, cancel, actor); err != nil {
			httpx.WriteInternal(w, r, s.Log, "billing: set cancel", err)
			return
		}
	}
	s.writeAccount(w, r)
}

func (s *Service) cancel(w http.ResponseWriter, r *http.Request) { s.setCancel(w, r, true) }
func (s *Service) resume(w http.ResponseWriter, r *http.Request) { s.setCancel(w, r, false) }

// lookupPrice resolves a price, nil when its key has no price yet.
func (s *Service) lookupPrice(ctx context.Context, key string) (*apitypes.Price, error) {
	p, err := s.Gateway.Price(ctx, key)
	if errors.Is(err, ErrPriceNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := &apitypes.Price{LookupKey: key, AmountCents: p.AmountCents, Currency: p.Currency}
	if p.Interval != "" {
		iv := apitypes.Interval(p.Interval)
		out.Interval = &iv
	}
	return out, nil
}
