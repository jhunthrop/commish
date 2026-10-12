package billing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// reconcileActor tags every write the reconcile makes.
const reconcileActor = "stripe_reconcile"

// ReconcileResult is one reconcile run's tally.
type ReconcileResult struct {
	Synced  int
	Ignored int
	Failed  int
}

// Reconcile re-reads every subscription a row still believes live and
// writes it exactly as a webhook would, healing anything a webhook
// never delivered. One subscription's failure never stops the rest:
// every failure is collected and returned joined, with the tally.
func (s *Service) Reconcile(ctx context.Context) (ReconcileResult, error) {
	var res ReconcileResult
	ids, err := s.Entitlements.LiveSubscriptionIDs(ctx)
	if err != nil {
		return res, fmt.Errorf("billing: reconcile: %w", err)
	}
	var failures []error
	for _, id := range ids {
		o, err := s.syncSubscription(ctx, id, reconcileActor)
		switch {
		case err != nil:
			res.Failed++
			failures = append(failures, fmt.Errorf("subscription %s: %w", id, err))
		case o.Kind == OutcomeIgnored:
			res.Ignored++
			s.Log.Warn("billing: reconcile ignored", "subscription", id, "reason", o.Reason)
		default:
			res.Synced++
		}
	}
	if len(failures) > 0 {
		return res, fmt.Errorf("billing: reconcile: %d of %d failed: %w", res.Failed, len(ids), errors.Join(failures...))
	}
	return res, nil
}

// ReminderLead is how far ahead of a renewal the reminder goes out
// (spec §2.6: seven days before any renewal).
const ReminderLead = 7 * 24 * time.Hour

// reminderWindow is how far past the lead a renewal still gets its
// reminder, so a daily job that misses one run catches up the next.
const reminderWindow = 48 * time.Hour

// Mailer sends one plain message. internal/mail implements it.
type Mailer interface {
	Send(ctx context.Context, to, subject, text string) error
}

// Renewals is the part of entitlements.Store the reminder job uses.
type Renewals interface {
	RenewalsDue(ctx context.Context, from, to time.Time) ([]entitlements.Renewal, error)
	RecordReminder(ctx context.Context, entitlementID int64, periodEnd time.Time) (bool, error)
	ForgetReminder(ctx context.Context, entitlementID int64, periodEnd time.Time) error
}

// Reminders is the renewal reminder job.
type Reminders struct {
	Renewals      Renewals
	Mail          Mailer
	PublicBaseURL string
	Now           func() time.Time
}

func (j *Reminders) message(r entitlements.Renewal, planNames map[string]string) (string, string) {
	when := r.CurrentPeriodEnd.UTC().Format("January 2, 2006")
	plan := "Membership"
	if r.Interval != nil {
		if p, ok := planNames[*r.Interval]; ok {
			plan = p
		}
	}
	subject := "Your Commish Membership renews on " + when
	text := fmt.Sprintf("Your %s renews on %s and your card on file will be charged then.\n\n"+
		"To stop it, cancel in one click on your account page, and the Membership runs to the end of what you paid for:\n%s\n",
		plan, when, j.PublicBaseURL+pathAccount)
	return subject, text
}

// Run mails every member whose Membership renews in the next
// ReminderLead (plus the catch-up window) and has not been reminded for
// that renewal. A reminder is recorded before it is sent, so two runs
// never mail twice, and forgotten again if the send fails.
func (j *Reminders) Run(ctx context.Context) (int, error) {
	now := j.Now()
	due, err := j.Renewals.RenewalsDue(ctx, now.Add(ReminderLead-reminderWindow), now.Add(ReminderLead))
	if err != nil {
		return 0, err
	}
	names := map[string]string{"year": "annual Membership", "month": "monthly Membership"}
	sent := 0
	for _, r := range due {
		if r.CurrentPeriodEnd == nil {
			continue
		}
		claimed, err := j.Renewals.RecordReminder(ctx, r.EntitlementID, *r.CurrentPeriodEnd)
		if err != nil {
			return sent, err
		}
		if !claimed {
			continue
		}
		subject, text := j.message(r, names)
		if err := j.Mail.Send(ctx, r.Email, subject, text); err != nil {
			if ferr := j.Renewals.ForgetReminder(ctx, r.EntitlementID, *r.CurrentPeriodEnd); ferr != nil {
				return sent, fmt.Errorf("billing: reminder %d: send: %w, then forget: %v", r.EntitlementID, err, ferr)
			}
			return sent, fmt.Errorf("billing: reminder %d: %w", r.EntitlementID, err)
		}
		sent++
	}
	return sent, nil
}
