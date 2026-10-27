// Command room is the live room service (spec §2.2): one process per
// instance holding lobbies' clocks, WebSockets to the drafters with
// session affinity, state as the app.room_actions log. Every room's
// clock runs under a lease this instance renews; a sweep adopts any live
// room whose lease lapsed, so a room outlives the instance it started on.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/devices"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/lobby"
	"github.com/jhunthrop/commish/api/internal/metrics"
	"github.com/jhunthrop/commish/api/internal/rooms"
	"github.com/jhunthrop/commish/api/internal/server"
	"github.com/jhunthrop/commish/api/internal/sheets"
)

// version is set at build: -ldflags "-X main.version=<git sha>".
var version = "dev"

const startupPingTimeout = 5 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "room", "version", version)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, log); err != nil {
		log.Error("exit", "err", err)
		os.Exit(1)
	}
}

// instanceName tells this process apart in a room's lease: the
// configured name, else the host and a random suffix.
func instanceName(configured string) string {
	if configured != "" {
		return configured
	}
	host, _ := os.Hostname()
	var b [4]byte
	_, _ = rand.Read(b[:])
	return host + "-" + hex.EncodeToString(b[:])
}

func run(ctx context.Context, log *slog.Logger) error {
	cfg, err := config.LoadRoom(os.Getenv)
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

	sessions, err := auth.NewSessions(cfg.Session, cfg.HTTP.TrustedProxyHops, &auth.Store{Pool: pool}, time.Now, log)
	if err != nil {
		return err
	}
	// An app signs in to the room with its device token, by the same check
	// the api's session routes make (auth.Bearer.SessionDevice).
	bearer, err := auth.NewBearer(cfg.Session.CookiePassword, cfg.HTTP.TrustedProxyHops, &devices.Store{Pool: pool}, time.Now, log)
	if err != nil {
		return err
	}
	draftBoards, closeBoards, err := draftroom.OpenBoards(pool, cfg.Board, time.Now, log)
	if err != nil {
		return err
	}
	defer closeBoards()
	hub := &rooms.Hub{URL: cfg.ListenURL, Log: log}
	store := &lobby.Store{Pool: pool, Now: time.Now, OnWrite: hub.Signal}
	owners := &rooms.Owners{
		Pool: pool, Store: store, Hub: hub, Instance: instanceName(cfg.Instance), Now: time.Now, Log: log,
		Clock: &lobby.Clock{Store: store, Boards: draftBoards, Sheets: &sheets.Store{Pool: pool, Season: cfg.Board.Season}},
		Lease: rooms.DefaultLease, Renew: rooms.DefaultRenew, Sweep: rooms.DefaultSweep,
	}
	socket := &rooms.Socket{Lobby: store, Hub: hub, Adopt: owners.Adopt, OriginHosts: rooms.OriginHosts(cfg.HTTP.CORSOrigins), Devices: bearer, Now: time.Now, Log: log}
	owners.Serving = socket.Serving

	mux := http.NewServeMux()
	routes := slices.Concat(server.Health(pool, version), socket.Routes())
	if err := server.Mount(mux, routes, sessions, bearer, time.Now); err != nil {
		return err
	}
	// The clocks stop and give their leases up when the server stops,
	// whether by signal or by failing.
	bgCtx, stopBackground := context.WithCancel(ctx)
	var background sync.WaitGroup
	background.Add(2)
	go func() { defer background.Done(); hub.Run(bgCtx) }()
	go func() { defer background.Done(); owners.Run(bgCtx) }()
	defer background.Wait()
	defer stopBackground()
	registry := metrics.New()
	public := server.Stack(mux, log, registry, cfg.HTTP.CORSOrigins, cfg.AllowedHosts)
	return server.Run(ctx, log, cfg.HTTP.Port, public, cfg.HTTP.MetricsPort, registry.Handler())
}
