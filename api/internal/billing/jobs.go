package billing

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// reconcileActor tags every write the reconcile makes.
const reconcileActor = "stripe_reconcile"

// Reconcile re-reads every subscription a row still believes live and
// writes it exactly as a webhook would, healing anything a webhook
// never delivered. It returns how many it synced.
func (s *Service) Reconcile(ctx context.Context) (int, error) {
	ids, err := s.Entitlements.LiveSubscriptionIDs(ctx)
	if err != nil {
		return 0, fmt.Errorf("billing: reconcile: %w", err)
	}
	for i, id := range ids {
		if err := s.syncSubscription(ctx, id, reconcileActor); err != nil {
			return i, fmt.Errorf("billing: reconcile %s: %w", id, err)
		}
	}
	return len(ids), nil
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
