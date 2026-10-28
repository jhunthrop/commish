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
	"github.com/jhunthrop/commish/api/internal/deletion"
	"github.com/jhunthrop/commish/api/internal/devices"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/exports"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/inseason"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/metrics"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/names"
	"github.com/jhunthrop/commish/api/internal/notify"
	"github.com/jhunthrop/commish/api/internal/runs"
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
	handler, drain, err := build(ctx, cfg, pool, registry, log)
	if err != nil {
		return err
	}
	err = server.Run(ctx, log, cfg.HTTP.Port, handler, cfg.HTTP.MetricsPort, registry.Handler())
	// ctx is done: the season reads' refreshes behind stop, and the pool
	// closes once they have released their connections.
	drain()
	return err
}

// build wires every package and returns the whole handler, and the drain
// shutdown runs before the pool closes.
func build(ctx context.Context, cfg config.API, pool *pgxpool.Pool, obs httpx.Observer, log *slog.Logger) (http.Handler, func(), error) {
	now := time.Now
	authStore := &auth.Store{Pool: pool}
	ents := &entitlements.Store{Pool: pool, Free: entitlements.FreeSeason(cfg.FreeSeason)}
	if ents.Free != entitlements.NoFreeSeason {
		log.Info("free season", "season", cfg.FreeSeason, "ends_at", ents.Free.EndsAt(), "open", ents.Free.Open(now()))
	}
	sessions, err := auth.NewSessions(cfg.Session, cfg.HTTP.TrustedProxyHops, authStore, now, log)
	if err != nil {
		return nil, nil, err
	}
	deviceStore := &devices.Store{Pool: pool}
	bearer, err := auth.NewBearer(cfg.Session.CookiePassword, cfg.HTTP.TrustedProxyHops, deviceStore, now, log)
	if err != nil {
		return nil, nil, err
	}
	codeKey, err := auth.DeriveKey(cfg.Session.CookiePassword, devices.PurposeCodes)
	if err != nil {
		return nil, nil, err
	}
	nameFilter, err := names.Default()
	if err != nil {
		return nil, nil, err
	}
	anon, err := auth.NewAnon(cfg.Session, cfg.HTTP.CORSOrigins)
	if err != nil {
		return nil, nil, err
	}
	mockStore := &mocks.Store{Pool: pool}
	stateSealer, err := auth.NewStateSealer(cfg.Session.CookiePassword)
	if err != nil {
		return nil, nil, err
	}
	// The board's pool lives as long as the process.
	draftBoards, _, err := draftroom.OpenBoards(pool, cfg.Board, now, log)
	if err != nil {
		return nil, nil, err
	}
	if err := customBoards(ctx, cfg.Board, draftBoards, now, log); err != nil {
		return nil, nil, err
	}
	// The site's season reads the board's schedule, kept an hour: one
	// source for /me, GET /season, the leagues' phases and Sleeper's week.
	site := &season.Site{Facts: draftBoards.Schedule, Now: now, Log: log}
	// Push (Lane 262): the outbox, the members' settings /me carries, and
	// the app registrations on their devices.
	notifyStore := &notify.Store{Pool: pool}
	pushSettings := &notify.Settings{Store: notifyStore}
	viewer := &account.Viewer{
		Entitlements: ents, Leagues: &leaguesync.Store{Pool: pool, Now: now, Season: site}, Season: site,
		Notifications: pushSettings, Now: now,
	}
	gate := &leagues.Gate{Entitlements: ents, Now: now, Log: log}
	leagueStore := &leagues.Store{Pool: pool}
	sheetStore := &sheets.Store{Pool: pool, Season: cfg.Board.Season}

	idp := auth.NewWorkOS(cfg.WorkOS.APIKey, cfg.WorkOS.ClientID, cfg.WorkOS.RedirectURI)
	deviceService := &devices.Service{
		Store: deviceStore, Push: deviceStore, Tokens: bearer, CodeKey: codeKey, Now: now, Log: log,
		IdP: idp, SignedOutURL: cfg.HTTP.PublicBaseURL + auth.SignedOutPath,
	}
	// The deleted accounts' WorkOS users still queued (Lane 233): the delete
	// route writes the queue, and sign-in refuses a user in it.
	deletionStore := &deletion.Store{Pool: pool}
	authHandler := &auth.Handler{
		Store: authStore, Sessions: sessions, Viewer: viewer, Names: nameFilter, StateSealer: stateSealer,
		IdP:           idp,
		PublicBaseURL: cfg.HTTP.PublicBaseURL, TrustedHops: cfg.HTTP.TrustedProxyHops, Now: now, Log: log,
		Anon: anon, Claimer: mockStore, AppCodes: deviceService, Deleting: deletionStore, Notifications: pushSettings,
	}
	sale := &season.Sale{Schedule: draftBoards.Schedule, Log: log}
	billingService := &billing.Service{
		Store: &billing.Store{Pool: pool}, Entitlements: ents, Gateway: gateway(cfg, log), Free: ents.Free,
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
	// One hourly capture read, kept for its TTL, serves the in-season
	// screens and the board route's designations alike; its dating is
	// shared with every instance through the app schema (Lane 133).
	facts := &inseason.Cache{Reads: draftBoards.Schedule, Now: now, Log: log, Context: ctx, Datings: &inseason.PGDatings{Pool: pool}}
	solo, lobbies, err := rooms(ctx, cfg, pool, draftBoards, mockStore, anon, gate, leagueStore, sheetStore, authStore, facts, log)
	if err != nil {
		return nil, nil, err
	}
	ff, err := newFFPCWiring(cfg, pool, log)
	if err != nil {
		return nil, nil, err
	}
	yh := newYahooWiring(cfg, pool, ff, log)
	es := newESPNWiring(cfg, pool, ff, log)
	mf, err := newMFLWiring(cfg, pool, ff, log)
	if err != nil {
		return nil, nil, err
	}
	companions, err := companionService(cfg, pool, solo, draftBoards.Schedule, ents, ff, log)
	if err != nil {
		return nil, nil, err
	}

	leagueSync := leagueSyncService(cfg, pool, draftBoards, leagueStore, ents, viewer, site, ff, yh, es, mf, log)
	moves, err := hostMoves(cfg, pool, ff, es, mf, log)
	if err != nil {
		return nil, nil, err
	}
	inSeason := &inseason.Service{
		Leagues: inseason.SyncLeagues{Sync: leagueSync}, Weeks: inseason.SyncLeagues{Sync: leagueSync}, Facts: facts,
		Holds: sheetStore, Moves: moves, Boards: draftBoards, Lives: &inseason.LiveBoards{Log: log},
		Season: draftBoards.Schedule.Season, Now: now, Log: log,
		Landings: inseason.SyncLeagues{Sync: leagueSync}, Context: ctx,
		Records: &leaguerecord.Service{Store: &leaguerecord.Store{Pool: pool}, Orders: draftBoards.Schedule},
	}
	// The season's reads fill and the run's boards build before the
	// listener opens, so neither /readyz nor the first request after a
	// deploy waits on them (Lane 112). Bounded; a failure only logs.
	inSeason.WarmAtStart(ctx, inseason.StartTimeout)
	// The trade search warms as each league read lands (Lane 66u).
	leagueSync.Poller.Landed = inSeason.OnLanded
	// While a game is under way every screen waits for a read under the
	// minute old (Lane 92): the schedule's one live window.
	leagueSync.Poller.Live = facts.Live

	// A member deletes their own account (Lane 233): their live lobby seats
	// given up, every row in one transaction, then the sign-in user.
	// The hourly capture's request for the starter status pushes (Lane
	// 262): verified, recorded and answered 202; the api-notify job runs
	// the producer.
	internal := &notify.Internal{
		Verifier: notify.GoogleIdentity{Audience: cfg.HTTP.APIBaseURL}, Callers: cfg.Push.InternalCallers,
		Requests: notifyStore, Now: now, Log: log,
	}

	deleter := &deletion.Service{
		Accounts: deletionStore, Rooms: lobbies.Store, Users: idp, Objects: exportHandler.Objects,
		Cookies: sessions, Now: now, Log: log,
	}

	routes := slices.Concat(
		server.Health(pool, version),
		authHandler.Routes(),
		deleter.Routes(),
		(&account.SeasonHandler{Season: site}).Routes(),
		(&leagues.Handler{Store: leagueStore, Gate: gate, Log: log}).Routes(),
		(&sheets.Handler{Store: sheetStore, Log: log}).Routes(),
		exportHandler.Routes(),
		billingService.Routes(),
		(&mocks.Handler{Store: mockStore, Log: log}).Routes(),
		solo.Routes(),
		(&runs.Handler{Reader: runReader(cfg, now, log), Log: log}).Routes(),
		lobbies.Routes(),
		companions.Routes(),
		deviceService.Routes(),
		internal.Routes(),
		leagueSync.Routes(),
		inSeason.Routes(),
		moves.Routes(),
		hostList(ff, yh, es, mf, moves, log),
		ff.routes(log),
		yh.routes(cfg, pool, ff, log),
		es.routes(pool, ff, log),
		mf.routes(),
		devRoutes,
	)
	mux := http.NewServeMux()
	if err := server.Mount(mux, routes, sessions, bearer, now); err != nil {
		return nil, nil, err
	}
	return server.Stack(mux, log, obs, cfg.HTTP.CORSOrigins, cfg.AllowedHosts), facts.Drain, nil
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

// runReader is the published nightly run, or nil (the /run routes answer
// 503) when the runs' bucket has no keys here.
func runReader(cfg config.API, now func() time.Time, log *slog.Logger) *runs.Reader {
	if !cfg.Runs.Configured() {
		log.Warn("runs bucket not configured", "effect", "the /run routes answer 503")
		return nil
	}
	objects, err := runs.NewR2Objects(cfg.Runs)
	if err != nil {
		log.Error("runs", "err", err)
		return nil
	}
	return runs.NewReader(objects, now, log)
}

func usage() error {
	return fmt.Errorf("usage: api [%s]", jobNames())
}
