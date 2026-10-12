// Command api is the prep site's request API (spec §2.2). With no
// arguments it serves; with a job's name as its first argument it runs
// that job once and exits, so the Cloud Run jobs are this same image.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/account"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/billing"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/exports"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/names"
	"github.com/jhunthrop/commish/api/internal/server"
	"github.com/jhunthrop/commish/api/internal/sheets"
)

// version is set at build: -ldflags "-X main.version=<git sha>".
var version = "dev"

// startupPingTimeout bounds the first database ping. A failure is
// logged, not fatal: Neon's compute may be waking, and /readyz reports
// it until it answers.
const startupPingTimeout = 5 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "api", "version", version)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var err error
	if len(os.Args) > 1 {
		err = runJob(ctx, log, os.Args[1], os.Args[2:])
	} else {
		err = serve(ctx, log)
	}
	if err != nil {
		log.Error("exit", "err", err)
		os.Exit(1)
	}
}

func serve(ctx context.Context, log *slog.Logger) error {
	cfg, err := config.LoadAPI(os.Getenv)
	if err != nil {
		return err
	}
	pool, err := db.Open(cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()
	pingCtx, cancel := context.WithTimeout(ctx, startupPingTimeout)
	if err := pool.Ping(pingCtx); err != nil {
		log.Warn("database not reachable at start", "err", err)
	}
	cancel()
	handler, err := build(cfg, pool, log)
	if err != nil {
		return err
	}
	return server.Serve(ctx, cfg.HTTP.Port, handler, log)
}

// build wires every package and returns the whole handler.
func build(cfg config.API, pool *pgxpool.Pool, log *slog.Logger) (http.Handler, error) {
	now := time.Now
	authStore := &auth.Store{Pool: pool}
	ents := &entitlements.Store{Pool: pool}
	sessions, err := auth.NewSessions(cfg.Session, authStore, now, log)
	if err != nil {
		return nil, err
	}
	stateSealer, err := auth.NewStateSealer(cfg.Session.CookiePassword)
	if err != nil {
		return nil, err
	}
	viewer := &account.Viewer{Entitlements: ents, Now: now}
	gate := &leagues.Gate{Entitlements: ents, Now: now, Log: log}
	leagueStore := &leagues.Store{Pool: pool}
	sheetStore := &sheets.Store{Pool: pool}

	authHandler := &auth.Handler{
		Store: authStore, Sessions: sessions, Viewer: viewer, Names: names.Default(), StateSealer: stateSealer,
		IdP:           auth.NewWorkOS(cfg.WorkOS.APIKey, cfg.WorkOS.ClientID, cfg.WorkOS.RedirectURI),
		PublicBaseURL: cfg.HTTP.PublicBaseURL, TrustedHops: cfg.HTTP.TrustedProxyHops, Now: now, Log: log,
	}
	billingService := &billing.Service{
		Store: &billing.Store{Pool: pool}, Entitlements: ents, Gateway: gateway(cfg, log),
		WebhookSecret: cfg.Stripe.WebhookSecret, Viewer: viewer, Handles: authStore,
		PublicBaseURL: cfg.HTTP.PublicBaseURL, Now: now, Log: log,
	}
	exportHandler := &exports.Handler{Store: &exports.Store{Pool: pool}, Sheets: sheetStore, Objects: objects(cfg, log), Now: now, Log: log}

	routes := slices.Concat(
		server.Health(pool, version),
		authHandler.Routes(),
		(&leagues.Handler{Store: leagueStore, Gate: gate, Log: log}).Routes(),
		(&sheets.Handler{Store: sheetStore, Log: log}).Routes(),
		exportHandler.Routes(),
		billingService.Routes(),
		(&mocks.Handler{Store: &mocks.Store{Pool: pool}, Leagues: leagueStore, Gate: gate, Log: log}).Routes(),
	)
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, auth.RateKey(cfg.HTTP.TrustedProxyHops), now); err != nil {
		return nil, err
	}
	return server.Stack(mux, log, cfg.HTTP.CORSOrigins, sessions), nil
}

// gateway is Stripe, or nil (billing answers 503) when it has no keys.
func gateway(cfg config.API, log *slog.Logger) billing.Gateway {
	if !cfg.Stripe.Configured() {
		log.Warn("stripe not configured", "effect", "billing routes answer 503")
		return nil
	}
	return billing.NewStripeGateway(cfg.Stripe.SecretKey, cfg.Stripe.AutomaticTax)
}

// objects is the exports bucket, or nil (exports answer 503) when R2
// has no credentials.
func objects(cfg config.API, log *slog.Logger) exports.Objects {
	if !cfg.R2.Configured() {
		log.Warn("r2 not configured", "effect", "export routes answer 503")
		return nil
	}
	r2, err := exports.NewR2(cfg.R2)
	if err != nil {
		log.Error("r2", "err", err)
		return nil
	}
	return r2
}

func usage() error {
	return fmt.Errorf("usage: api [%s]", jobNames())
}
