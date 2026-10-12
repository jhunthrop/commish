package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// maxWebhookBody is generous headroom over a checkout session event.
const maxWebhookBody = 256 << 10

func (s *Service) webhook(w http.ResponseWriter, r *http.Request) {
	if s.Gateway == nil || s.WebhookSecret == "" {
		writeUnavailable(w, r)
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, httpx.CodeInvalid, "The body could not be read", nil)
		return
	}
	// The signature is checked on the raw body before anything reads
	// it, with the library's five minute replay tolerance. The event's
	// API version may differ from the library's: the payload is used
	// only for ids, and every object is re-fetched through the library.
	event, err := webhook.ConstructEventWithOptions(payload, r.Header.Get("Stripe-Signature"), s.WebhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, httpx.CodeInvalid, "The signature does not check out", nil)
		return
	}
	// One delivery of an event at a time: Stripe's retry can overtake a
	// slow first attempt, and both must not see it unprocessed.
	err = s.Store.WithLock(r.Context(), "event:"+event.ID, func(ctx context.Context) error {
		proceed, err := s.Store.RecordEventOnce(ctx, event.ID, string(event.Type), payload)
		if err != nil || !proceed {
			return err
		}
		if err := s.handleEvent(ctx, event); err != nil {
			return err
		}
		return s.Store.MarkEventProcessed(ctx, event.ID)
	})
	if err != nil {
		// A 500 makes Stripe retry, which is what a transient failure
		// wants. The event row stays unprocessed for the retry.
		httpx.WriteInternal(w, r, s.Log, "billing: webhook "+string(event.Type), err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

func (s *Service) handleEvent(ctx context.Context, event stripe.Event) error {
	actor := "stripe:" + event.ID
	id, _ := event.Data.Object["id"].(string)
	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		return s.onCheckout(ctx, id, actor)
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		return s.syncSubscription(ctx, id, actor)
	case "invoice.paid", "invoice.payment_failed":
		if sub := subscriptionOfInvoice(event.Data.Raw); sub != "" {
			return s.syncSubscription(ctx, sub, actor)
		}
		return nil
	case "charge.refunded":
		return s.onRefund(ctx, event.Data.Raw, actor)
	default:
		// Recorded, not acted on: the endpoint's event list is the
		// filter, and this is the safety net if it drifts.
		return nil
	}
}

// subscriptionOfInvoice reads an invoice's subscription id, which moved
// under parent.subscription_details in Stripe's 2025 API versions.
func subscriptionOfInvoice(raw json.RawMessage) string {
	var inv struct {
		Subscription any `json:"subscription"`
		Parent       struct {
			SubscriptionDetails struct {
				Subscription any `json:"subscription"`
			} `json:"subscription_details"`
		} `json:"parent"`
	}
	if json.Unmarshal(raw, &inv) != nil {
		return ""
	}
	if id := refID(inv.Parent.SubscriptionDetails.Subscription); id != "" {
		return id
	}
	return refID(inv.Subscription)
}

// refID reads a Stripe reference that is either an id or an expanded
// object with one.
func refID(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case map[string]any:
		id, _ := t["id"].(string)
		return id
	}
	return ""
}

func accountOf(meta map[string]string) (uuid.UUID, error) {
	id, err := uuid.Parse(meta[metaAccountID])
	if err != nil {
		return uuid.Nil, fmt.Errorf("billing: metadata carries no account id")
	}
	return id, nil
}

// onCheckout re-reads the session and acts on what was bought. An
// unpaid session (a bank transfer still pending) waits for
// async_payment_succeeded.
func (s *Service) onCheckout(ctx context.Context, sessionID, actor string) error {
	sess, err := s.Gateway.GetCheckoutSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if sess.Mode == stripe.CheckoutSessionModeSubscription {
		if sess.Subscription == nil {
			return fmt.Errorf("billing: subscription checkout %s has no subscription", sessionID)
		}
		return s.syncSubscription(ctx, sess.Subscription.ID, actor)
	}
	if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		return nil
	}
	accountID, err := accountOf(sess.Metadata)
	if err != nil {
		return fmt.Errorf("%w (session %s)", err, sessionID)
	}
	yr, err := strconv.Atoi(sess.Metadata[metaSeason])
	if err != nil {
		return fmt.Errorf("billing: session %s carries no season", sessionID)
	}
	var paymentIntent string
	if sess.PaymentIntent != nil {
		paymentIntent = sess.PaymentIntent.ID
	}
	switch apitypes.Product(sess.Metadata[metaProduct]) {
	case apitypes.ProductDraftPass:
		_, err := s.Entitlements.GrantPass(ctx, entitlements.PassGrant{
			AccountID: accountID, Season: yr, Source: entitlements.SourcePurchase,
			CheckoutSessionID: sessionID, PaymentIntentID: paymentIntent, GrantedBy: actor,
		})
		return err
	case apitypes.ProductGroupPass:
		seats, err := strconv.Atoi(sess.Metadata[metaSeats])
		if err != nil {
			return fmt.Errorf("billing: session %s carries no seats", sessionID)
		}
		return s.Store.CreateGroupPass(ctx, NewGroupPass{
			PurchaserID: accountID, LeagueName: sess.Metadata[metaLeagueName], Season: yr, Seats: seats,
			ClaimCode: newClaimCode(), CheckoutSessionID: sessionID, PaymentIntentID: paymentIntent,
		})
	default:
		return fmt.Errorf("billing: session %s sold an unknown product %q", sessionID, sess.Metadata[metaProduct])
	}
}

// subscriptionPeriodEnd reads the paid period's end from the first
// item: Stripe's 2025 API versions moved it off the subscription. Every
// Membership has exactly one item.
func subscriptionPeriodEnd(sub *stripe.Subscription) (time.Time, error) {
	if sub.Items == nil || len(sub.Items.Data) == 0 {
		return time.Time{}, fmt.Errorf("billing: subscription %s has no items", sub.ID)
	}
	return time.Unix(sub.Items.Data[0].CurrentPeriodEnd, 0).UTC(), nil
}

func subscriptionInterval(sub *stripe.Subscription) string {
	if sub.Items == nil || len(sub.Items.Data) == 0 || sub.Items.Data[0].Price == nil || sub.Items.Data[0].Price.Recurring == nil {
		return ""
	}
	return string(sub.Items.Data[0].Price.Recurring.Interval)
}

// syncSubscription is the only path from Stripe's subscription state to
// a Membership row: re-fetched fresh, never from an event's snapshot.
func (s *Service) syncSubscription(ctx context.Context, subscriptionID, actor string) error {
	sub, err := s.Gateway.GetSubscription(ctx, subscriptionID)
	if err != nil {
		return err
	}
	accountID, err := accountOf(sub.Metadata)
	if err != nil {
		return fmt.Errorf("%w (subscription %s)", err, sub.ID)
	}
	end, err := subscriptionPeriodEnd(sub)
	if err != nil {
		return err
	}
	if err := s.Entitlements.UpsertSubscription(ctx, entitlements.SubscriptionState{
		AccountID: accountID, SubscriptionID: sub.ID, Status: string(sub.Status), Interval: subscriptionInterval(sub),
		CurrentPeriodEnd: end, CancelAtPeriodEnd: sub.CancelAtPeriodEnd, GrantedBy: actor,
	}); err != nil {
		return err
	}
	return s.guardDuplicate(ctx, accountID, sub, actor)
}

// guardDuplicate cancels a second live Membership at its period end, so
// a member who somehow paid twice is never billed twice again. The
// first payment is refunded by hand from the log line.
func (s *Service) guardDuplicate(ctx context.Context, accountID uuid.UUID, sub *stripe.Subscription, actor string) error {
	live := sub.Status == stripe.SubscriptionStatusActive || sub.Status == stripe.SubscriptionStatusTrialing
	if !live || sub.CancelAtPeriodEnd {
		return nil
	}
	other, err := s.Entitlements.OtherLiveSubscription(ctx, accountID, sub.ID, s.Now())
	if err != nil || other == "" {
		return err
	}
	s.Log.Error("billing: duplicate membership", "account_id", accountID, "kept", other, "canceled", sub.ID)
	if err := s.Gateway.SetCancelAtPeriodEnd(ctx, sub.ID, true); err != nil {
		return err
	}
	return s.Entitlements.SetCancelAtPeriodEnd(ctx, sub.ID, true, actor)
}

// onRefund ends whatever a fully refunded payment bought. A partial
// refund is a goodwill credit and leaves the pass in place.
func (s *Service) onRefund(ctx context.Context, raw json.RawMessage, actor string) error {
	var charge stripe.Charge
	if err := json.Unmarshal(raw, &charge); err != nil {
		return fmt.Errorf("billing: decode refunded charge: %w", err)
	}
	if !charge.Refunded || charge.PaymentIntent == nil {
		return nil
	}
	pi := charge.PaymentIntent.ID
	if _, err := s.Entitlements.RefundPayment(ctx, pi, actor); err != nil {
		return err
	}
	_, err := s.Entitlements.RefundGroupPass(ctx, pi, actor)
	return err
}
