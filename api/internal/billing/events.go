package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	stripe "github.com/stripe/stripe-go/v82"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// accountOf reads the account a Stripe object was made for. ok is false
// for an object made outside our checkout.
func accountOf(meta map[string]string) (uuid.UUID, bool) {
	id, err := uuid.Parse(meta[metaAccountID])
	return id, err == nil
}

// onCheckout re-reads the session and acts on what was bought. An
// unpaid session (a bank transfer still pending) waits for
// async_payment_succeeded.
func (s *Service) onCheckout(ctx context.Context, sessionID, actor string) (Outcome, error) {
	sess, err := s.Gateway.GetCheckoutSession(ctx, sessionID)
	if err != nil {
		return Outcome{}, err
	}
	if sess.Mode == stripe.CheckoutSessionModeSubscription {
		if err := s.Store.CloseCheckout(ctx, sessionID, checkoutCompleted); err != nil {
			return Outcome{}, err
		}
		if sess.Subscription == nil {
			return ignored("the subscription checkout carries no subscription"), nil
		}
		return s.syncSubscription(ctx, sess.Subscription.ID, actor)
	}
	if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		return ignored("the payment is not settled yet"), nil
	}
	if err := s.Store.CloseCheckout(ctx, sessionID, checkoutCompleted); err != nil {
		return Outcome{}, err
	}
	accountID, ok := accountOf(sess.Metadata)
	if !ok {
		return ignored("the session carries no account, it was not made by our checkout"), nil
	}
	yr, err := strconv.Atoi(sess.Metadata[metaSeason])
	if err != nil {
		return ignored("the session carries no season"), nil
	}
	var paymentIntent string
	if sess.PaymentIntent != nil {
		paymentIntent = sess.PaymentIntent.ID
	}
	switch apitypes.Product(sess.Metadata[metaProduct]) {
	case apitypes.ProductDraftPass:
		return s.grantPass(ctx, accountID, yr, sessionID, paymentIntent, actor)
	case apitypes.ProductGroupPass:
		seats, err := strconv.Atoi(sess.Metadata[metaSeats])
		if err != nil {
			return ignored("the session carries no seat count"), nil
		}
		return applied(), s.Store.CreateGroupPass(ctx, NewGroupPass{
			PurchaserID: accountID, LeagueName: sess.Metadata[metaLeagueName], Season: yr, Seats: seats,
			ClaimCode: newClaimCode(), CheckoutSessionID: sessionID, PaymentIntentID: paymentIntent,
		})
	default:
		return ignored(fmt.Sprintf("the session sold an unknown product %q", sess.Metadata[metaProduct])), nil
	}
}

// grantPass writes the Draft Pass a session paid for, unless the
// account already holds that season's pass from another payment (two
// checkout tabs, both paid). Then the second payment is refunded in
// full through Stripe and the event says so, never a second grant. One
// account at a time, so two such webhooks cannot both grant.
func (s *Service) grantPass(ctx context.Context, accountID uuid.UUID, yr int, sessionID, paymentIntent, actor string) (Outcome, error) {
	var o Outcome
	err := s.Store.WithLock(ctx, "pass:"+accountID.String(), func(ctx context.Context) error {
		dup, err := s.Entitlements.HasOtherLivePass(ctx, accountID, yr, sessionID, s.Now())
		if err != nil {
			return err
		}
		if !dup {
			_, err := s.Entitlements.GrantPass(ctx, entitlements.PassGrant{
				AccountID: accountID, Season: yr, Source: entitlements.SourcePurchase,
				CheckoutSessionID: sessionID, PaymentIntentID: paymentIntent, GrantedBy: actor,
			})
			o = applied()
			return err
		}
		if paymentIntent == "" {
			return fmt.Errorf("billing: duplicate pass from session %s has no payment to refund", sessionID)
		}
		s.Log.Error("billing: duplicate draft pass", "account_id", accountID, "season", yr, "session", sessionID)
		if err := s.Gateway.RefundDuplicate(ctx, paymentIntent); err != nil {
			return err
		}
		o = outcome(OutcomeRefundedDuplicate, fmt.Sprintf("the account already held the %d pass, payment refunded", yr))
		return nil
	})
	return o, err
}

// subscriptionPeriodEnd reads the paid period's end from the first
// item: Stripe's 2025 API versions moved it off the subscription. Every
// Membership has exactly one item.
func subscriptionPeriodEnd(sub *stripe.Subscription) (time.Time, bool) {
	if sub.Items == nil || len(sub.Items.Data) == 0 {
		return time.Time{}, false
	}
	return time.Unix(sub.Items.Data[0].CurrentPeriodEnd, 0).UTC(), true
}

func subscriptionInterval(sub *stripe.Subscription) string {
	if sub.Items == nil || len(sub.Items.Data) == 0 || sub.Items.Data[0].Price == nil || sub.Items.Data[0].Price.Recurring == nil {
		return ""
	}
	return string(sub.Items.Data[0].Price.Recurring.Interval)
}

// syncSubscription is the only path from Stripe's subscription state to
// a Membership row: re-fetched fresh, never from an event's snapshot.
func (s *Service) syncSubscription(ctx context.Context, subscriptionID, actor string) (Outcome, error) {
	sub, err := s.Gateway.GetSubscription(ctx, subscriptionID)
	if err != nil {
		return Outcome{}, err
	}
	accountID, ok := accountOf(sub.Metadata)
	if !ok {
		return ignored("the subscription carries no account, it was not made by our checkout"), nil
	}
	end, ok := subscriptionPeriodEnd(sub)
	if !ok {
		return ignored("the subscription has no items"), nil
	}
	if err := s.Entitlements.UpsertSubscription(ctx, entitlements.SubscriptionState{
		AccountID: accountID, SubscriptionID: sub.ID, Status: string(sub.Status), Interval: subscriptionInterval(sub),
		CurrentPeriodEnd: end, CancelAtPeriodEnd: sub.CancelAtPeriodEnd, GrantedBy: actor,
	}); err != nil {
		return Outcome{}, err
	}
	return applied(), s.guardDuplicate(ctx, accountID, sub, actor)
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
func (s *Service) onRefund(ctx context.Context, raw json.RawMessage, actor string) (Outcome, error) {
	var charge stripe.Charge
	if err := json.Unmarshal(raw, &charge); err != nil {
		return ignored("the charge could not be read"), nil
	}
	if !charge.Refunded || charge.PaymentIntent == nil {
		return ignored("a partial refund leaves the pass in place"), nil
	}
	_, err := s.Entitlements.EndPayment(ctx, charge.PaymentIntent.ID, entitlements.EndRefunded, actor)
	return applied(), err
}

func disputeOf(raw json.RawMessage) (stripe.Dispute, bool) {
	var d stripe.Dispute
	if json.Unmarshal(raw, &d) != nil || d.PaymentIntent == nil {
		return d, false
	}
	return d, true
}

// onDisputeCreated ends what a disputed payment bought the moment the
// dispute opens: a pass (or a group pass and its claims), or the
// Membership the payment renewed, canceled at Stripe at once.
func (s *Service) onDisputeCreated(ctx context.Context, raw json.RawMessage, actor string) (Outcome, error) {
	d, ok := disputeOf(raw)
	if !ok {
		return ignored("the dispute names no payment"), nil
	}
	pi := d.PaymentIntent.ID
	reason := fmt.Sprintf("dispute %s opened, reason %s", d.ID, d.Reason)
	n, err := s.Entitlements.EndPayment(ctx, pi, entitlements.EndDisputed, actor)
	if err != nil || n > 0 {
		return outcome(OutcomeEndedByDispute, reason), err
	}
	sub, err := s.Gateway.SubscriptionForPayment(ctx, pi)
	if err != nil {
		return Outcome{}, err
	}
	if sub == "" {
		return ignored("the disputed payment bought nothing on record"), nil
	}
	if err := s.Gateway.CancelSubscriptionNow(ctx, sub); err != nil {
		return Outcome{}, err
	}
	if err := s.Entitlements.EndSubscription(ctx, sub, entitlements.EndDisputed, s.Now(), actor); err != nil {
		return Outcome{}, err
	}
	return outcome(OutcomeEndedByDispute, reason+", membership canceled"), nil
}

// onDisputeClosed restores a pass whose dispute we won. A Membership
// canceled for a dispute stays canceled: Stripe cannot resume it, and
// the member can join again.
func (s *Service) onDisputeClosed(ctx context.Context, raw json.RawMessage, actor string) (Outcome, error) {
	d, ok := disputeOf(raw)
	if !ok {
		return ignored("the dispute names no payment"), nil
	}
	if d.Status != stripe.DisputeStatusWon {
		return outcome(OutcomeDisputeClosed, fmt.Sprintf("dispute %s closed %s, access stays ended", d.ID, d.Status)), nil
	}
	n, err := s.Entitlements.RestorePayment(ctx, d.PaymentIntent.ID, actor)
	return outcome(OutcomeDisputeClosed, fmt.Sprintf("dispute %s won, %d passes restored", d.ID, n)), err
}
