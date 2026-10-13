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
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/exports"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/metrics"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/names"
	"github.com/jhunthrop/commish/api/internal/season"
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
	registry := metrics.New()
	handler, err := build(ctx, cfg, pool, registry, log)
	if err != nil {
		return err
	}
	return server.Run(ctx, log, cfg.HTTP.Port, handler, cfg.HTTP.MetricsPort, registry.Handler())
}

// build wires every package and returns the whole handler.
func build(ctx context.Context, cfg config.API, pool *pgxpool.Pool, obs httpx.Observer, log *slog.Logger) (http.Handler, error) {
	now := time.Now
	authStore := &auth.Store{Pool: pool}
	ents := &entitlements.Store{Pool: pool}
	sessions, err := auth.NewSessions(cfg.Session, cfg.HTTP.TrustedProxyHops, authStore, now, log)
	if err != nil {
		return nil, err
	}
	nameFilter, err := names.Default()
	if err != nil {
		return nil, err
	}
	anon, err := auth.NewAnon(cfg.Session, cfg.HTTP.CORSOrigins)
	if err != nil {
		return nil, err
	}
	mockStore := &mocks.Store{Pool: pool}
	stateSealer, err := auth.NewStateSealer(cfg.Session.CookiePassword)
	if err != nil {
		return nil, err
	}
	viewer := &account.Viewer{Entitlements: ents, Leagues: &leaguesync.Store{Pool: pool}, Now: now}
	gate := &leagues.Gate{Entitlements: ents, Now: now, Log: log}
	leagueStore := &leagues.Store{Pool: pool}
	sheetStore := &sheets.Store{Pool: pool}

	authHandler := &auth.Handler{
		Store: authStore, Sessions: sessions, Viewer: viewer, Names: nameFilter, StateSealer: stateSealer,
		IdP:           auth.NewWorkOS(cfg.WorkOS.APIKey, cfg.WorkOS.ClientID, cfg.WorkOS.RedirectURI),
		PublicBaseURL: cfg.HTTP.PublicBaseURL, TrustedHops: cfg.HTTP.TrustedProxyHops, Now: now, Log: log,
		Anon: anon, Claimer: mockStore,
	}
	// The board's pool lives as long as the process.
	draftBoards, _, err := draftroom.OpenBoards(pool, cfg.Board, now)
	if err != nil {
		return nil, err
	}
	sale := &season.Sale{Schedule: draftBoards.Schedule, Log: log}
	billingService := &billing.Service{
		Store: &billing.Store{Pool: pool}, Entitlements: ents, Gateway: gateway(cfg, log),
		WebhookSecret: cfg.Stripe.WebhookSecret, Viewer: viewer, Handles: authStore, Catalog: ents, Sale: sale,
		PublicBaseURL: cfg.HTTP.PublicBaseURL, Now: now, Log: log,
	}
	var devRoutes []httpx.Route
	if cfg.Dev.FakeBilling {
		fake, secret := billing.NewDevGateway(cfg.HTTP.APIBaseURL)
		billingService.Gateway, billingService.WebhookSecret = fake, secret
		devRoutes = billingService.DevRoutes(fake)
		log.Warn("billing is the development fake", "checkout", cfg.HTTP.APIBaseURL+"/billing/dev-checkout/")
	}
	exportHandler := &exports.Handler{Store: &exports.Store{Pool: pool}, Sheets: sheetStore, Objects: objects(cfg, log), Now: now, Log: log}
	solo, lobbies, err := rooms(ctx, cfg, pool, draftBoards, mockStore, anon, gate, leagueStore, sheetStore, authStore, log)
	if err != nil {
		return nil, err
	}
	companions, err := companionService(cfg, pool, solo, ents, log)
	if err != nil {
		return nil, err
	}

	routes := slices.Concat(
		server.Health(pool, version),
		authHandler.Routes(),
		(&leagues.Handler{Store: leagueStore, Gate: gate, Log: log}).Routes(),
		(&sheets.Handler{Store: sheetStore, Log: log}).Routes(),
		exportHandler.Routes(),
		billingService.Routes(),
		(&mocks.Handler{Store: mockStore, Log: log}).Routes(),
		solo.Routes(),
		lobbies.Routes(),
		companions.Routes(),
		leagueSyncService(cfg, pool, draftBoards, leagueStore, log).Routes(),
		devRoutes,
	)
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, now); err != nil {
		return nil, err
	}
	return server.Stack(mux, log, obs, cfg.HTTP.CORSOrigins), nil
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
