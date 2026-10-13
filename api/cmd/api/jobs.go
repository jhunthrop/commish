package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/billing"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/exports"
	"github.com/jhunthrop/commish/api/internal/mail"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/season"
)

// sweepBatch bounds how many expired exports one sweep deletes.
const sweepBatch = 1000

// job is one subcommand: the Cloud Run jobs run the image with its name
// as the first argument.
type job func(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, args []string) error

// jobTable is every job by name.
func jobTable() map[string]job {
	return map[string]job{
		// billing-reconcile runs nightly: every live subscription re-read.
		"billing-reconcile": runReconcile,
		// renewal-reminders runs daily: the mail seven days before a renewal.
		"renewal-reminders": runReminders,
		// sweep runs daily: expired sessions and exports.
		"sweep": runSweep,
		// stripe-setup runs by hand once per Stripe mode.
		"stripe-setup": runStripeSetup,
		// grant runs by hand: a pass or membership for support.
		"grant": runGrant,
	}
}

func jobNames() string {
	table := jobTable()
	names := make([]string, 0, len(table))
	for n := range table {
		names = append(names, n)
	}
	slices.Sort(names)
	return strings.Join(names, "|")
}

func runJob(ctx context.Context, log *slog.Logger, name string, args []string) error {
	run, ok := jobTable()[name]
	if !ok {
		return usage()
	}
	log = log.With("job", name)
	cfg, err := config.LoadAPI(os.Getenv)
	if err != nil {
		return err
	}
	pool, err := db.Connect(ctx, cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := run(ctx, log, cfg, pool, args); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

func requireStripe(cfg config.API) error {
	if !cfg.Stripe.Configured() {
		return errors.New("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required")
	}
	return nil
}

func runReconcile(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	if err := requireStripe(cfg); err != nil {
		return err
	}
	svc := &billing.Service{
		Store: &billing.Store{Pool: pool}, Entitlements: &entitlements.Store{Pool: pool},
		Gateway: billing.NewStripeGateway(cfg.Stripe.SecretKey, cfg.Stripe.AutomaticTax), Now: time.Now, Log: log,
	}
	n, err := svc.Reconcile(ctx)
	log.Info("reconciled", "synced", n.Synced, "ignored", n.Ignored, "failed", n.Failed)
	return err
}

func runReminders(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	if cfg.Mail.ResendAPIKey == "" {
		return errors.New("RESEND_API_KEY is required")
	}
	j := &billing.Reminders{
		Renewals: &entitlements.Store{Pool: pool}, Mail: mail.NewResend(cfg.Mail.ResendAPIKey, cfg.Mail.From),
		PublicBaseURL: cfg.HTTP.PublicBaseURL, Now: time.Now,
	}
	n, err := j.Run(ctx)
	log.Info("reminded", "sent", n)
	return err
}

func runSweep(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	now := time.Now()
	n, err := (&auth.Store{Pool: pool}).SweepExpiredSessions(ctx, now)
	if err != nil {
		return err
	}
	log.Info("swept sessions", "deleted", n)
	cleared, err := (&billing.Store{Pool: pool}).ClearEventPayloads(ctx, now.Add(-billing.EventPayloadRetention))
	if err != nil {
		return err
	}
	log.Info("cleared billing event payloads", "cleared", cleared)
	unclaimed, err := (&mocks.Store{Pool: pool}).SweepUnclaimed(ctx, now.Add(-auth.AnonTTL), now.Add(-auth.AnonEmptyTTL))
	if err != nil {
		return err
	}
	log.Info("swept unclaimed anonymous mocks", "deleted", unclaimed)
	if !cfg.R2.Configured() {
		log.Warn("r2 not configured", "effect", "exports not swept")
		return nil
	}
	r2, err := exports.NewR2(cfg.R2)
	if err != nil {
		return err
	}
	m, err := exports.Sweep(ctx, &exports.Store{Pool: pool}, r2, now, sweepBatch)
	log.Info("swept exports", "deleted", m)
	return err
}

// runStripeSetup makes sure every launch price exists (billing.
// LaunchPrices: spec §1 part 7, and the Group Draft Pass seat at $29, the
// Lane 8 ruling recorded as provisional in launch-items; the founder sets
// every 2027 price against the 2026 record). A price is created only when
// its lookup key has none, so repricing is a new price under the key in
// the Stripe dashboard, never this list.
func runStripeSetup(ctx context.Context, log *slog.Logger, cfg config.API, _ *pgxpool.Pool, _ []string) error {
	if err := requireStripe(cfg); err != nil {
		return err
	}
	g := billing.NewStripeGateway(cfg.Stripe.SecretKey, cfg.Stripe.AutomaticTax)
	for _, spec := range billing.LaunchPrices() {
		if err := g.EnsurePrice(ctx, spec); err != nil {
			return err
		}
		log.Info("price ready", "lookup_key", spec.LookupKey, "environment", cfg.Stripe.Environment)
	}
	return nil
}

// runGrant: grant <account-id> draft_pass [season] | grant <account-id> membership <days>.
func runGrant(ctx context.Context, log *slog.Logger, _ config.API, pool *pgxpool.Pool, args []string) error {
	if len(args) < 2 {
		return errors.New("usage: api grant <account-id> draft_pass [season] | membership <days>")
	}
	accountID, err := uuid.Parse(args[0])
	if err != nil {
		return fmt.Errorf("account id: %w", err)
	}
	store := &entitlements.Store{Pool: pool}
	actor := "grant:" + os.Getenv("USER")
	switch entitlements.Product(args[1]) {
	case entitlements.ProductDraftPass:
		yr := season.Of(time.Now())
		if len(args) > 2 {
			if yr, err = strconv.Atoi(args[2]); err != nil {
				return fmt.Errorf("season: %w", err)
			}
		}
		err = store.Grant(ctx, accountID, entitlements.ProductDraftPass, yr, season.End(yr), actor)
	case entitlements.ProductMembership:
		if len(args) < 3 {
			return errors.New("usage: api grant <account-id> membership <days>")
		}
		days, perr := strconv.Atoi(args[2])
		if perr != nil || days < 1 {
			return errors.New("days must be a whole number from 1")
		}
		err = store.Grant(ctx, accountID, entitlements.ProductMembership, 0, time.Now().AddDate(0, 0, days), actor)
	default:
		return fmt.Errorf("unknown product %q", args[1])
	}
	if err == nil {
		log.Info("granted", "account_id", accountID, "product", args[1])
	}
	return err
}
