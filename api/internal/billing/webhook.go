package billing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/jhunthrop/commish/api/internal/httpx"
)

// maxWebhookBody is generous headroom over a checkout session event.
const maxWebhookBody = 256 << 10

// OutcomeKind is what became of an event, kept on its row.
type OutcomeKind string

const (
	OutcomeApplied           OutcomeKind = "applied"
	OutcomeIgnored           OutcomeKind = "ignored"
	OutcomeRefundedDuplicate OutcomeKind = "refunded_duplicate"
	OutcomeEndedByDispute    OutcomeKind = "ended_by_dispute"
	OutcomeDisputeClosed     OutcomeKind = "dispute_closed"
)

// Outcome is an event's result and, when it was not simply applied,
// why. An ignored event is answered 200 and never retried: it can
// never succeed (a payment made outside our checkout, a type we do not
// act on). Only a transient failure is an error and a 500.
type Outcome struct {
	Kind   OutcomeKind
	Reason string
}

func applied() Outcome                             { return Outcome{Kind: OutcomeApplied} }
func ignored(reason string) Outcome                { return Outcome{Kind: OutcomeIgnored, Reason: reason} }
func outcome(k OutcomeKind, reason string) Outcome { return Outcome{Kind: k, Reason: reason} }

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
		proceed, err := s.Store.RecordEventOnce(ctx, event.ID, string(event.Type), trimPayload(event))
		if err != nil || !proceed {
			return err
		}
		o, err := s.handleEvent(ctx, event)
		if err != nil {
			return err
		}
		if o.Kind != OutcomeApplied {
			s.Log.Warn("billing: event", "event_id", event.ID, "type", event.Type, "outcome", o.Kind, "reason", o.Reason)
		}
		return s.Store.MarkEventProcessed(ctx, event.ID, o)
	})
	if err != nil {
		// A 500 makes Stripe retry, which is what a transient failure
		// wants. The event row stays unprocessed for the retry.
		httpx.WriteInternal(w, r, s.Log, "billing: webhook "+string(event.Type), err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

// keptObjectFields are the only fields of an event's object the
// handlers read. Everything else, the customer's email and address
// included, is dropped before the event is stored.
func keptObjectFields() []string {
	return []string{
		"id", "object", "mode", "payment_status", "payment_intent", "subscription",
		"refunded", "charge", "status", "reason", "amount",
	}
}

// trimPayload is the stored form of an event: its envelope and the kept
// fields of its object, plus an invoice's subscription reference.
func trimPayload(event stripe.Event) []byte {
	obj := map[string]any{}
	for _, k := range keptObjectFields() {
		if v, ok := event.Data.Object[k]; ok {
			obj[k] = v
		}
	}
	if sub := subscriptionOfInvoice(event.Data.Raw); sub != "" {
		obj["subscription"] = sub
	}
	out, err := json.Marshal(map[string]any{
		"id": event.ID, "type": event.Type, "created": event.Created, "api_version": event.APIVersion,
		"data": map[string]any{"object": obj},
	})
	if err != nil {
		return []byte(`{}`)
	}
	return out
}

func (s *Service) handleEvent(ctx context.Context, event stripe.Event) (Outcome, error) {
	actor := "stripe:" + event.ID
	id, _ := event.Data.Object["id"].(string)
	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		return s.onCheckout(ctx, id, actor)
	case "checkout.session.expired":
		return applied(), s.Store.CloseCheckout(ctx, id, checkoutExpired)
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		return s.syncSubscription(ctx, id, actor)
	case "invoice.paid", "invoice.payment_failed":
		if sub := subscriptionOfInvoice(event.Data.Raw); sub != "" {
			return s.syncSubscription(ctx, sub, actor)
		}
		return ignored("the invoice is not a subscription's"), nil
	case "charge.refunded":
		return s.onRefund(ctx, event.Data.Raw, actor)
	case "charge.dispute.created":
		return s.onDisputeCreated(ctx, event.Data.Raw, actor)
	case "charge.dispute.closed":
		return s.onDisputeClosed(ctx, event.Data.Raw, actor)
	default:
		// The endpoint's event list is the filter; this is the safety
		// net if it drifts.
		return ignored("this event type is not acted on"), nil
	}
}

// subscriptionOfInvoice reads an invoice's subscription id, which moved
// under parent.subscription_details in Stripe's 2025 API versions.
func subscriptionOfInvoice(raw json.RawMessage) string {
	var inv struct {
		Object       string `json:"object"`
		Subscription any    `json:"subscription"`
		Parent       struct {
			SubscriptionDetails struct {
				Subscription any `json:"subscription"`
			} `json:"subscription_details"`
		} `json:"parent"`
	}
	if json.Unmarshal(raw, &inv) != nil || inv.Object != "invoice" {
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
