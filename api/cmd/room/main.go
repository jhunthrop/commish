// Command room is the live room service (spec §2.2): one process per
// instance holding lobbies' clocks, WebSockets to the drafters with
// session affinity, state as the app.room_actions log. Today it serves
// health and the socket's seq handshake; the lobby lane (Lane 6) adds
// the clock, the queue and the broadcast.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/rooms"
	"github.com/jhunthrop/commish/api/internal/server"
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

	sessions, err := auth.NewSessions(cfg.Session, &auth.Store{Pool: pool}, time.Now, log)
	if err != nil {
		return err
	}
	socket := &rooms.Socket{
		Actions: &rooms.Store{Pool: pool}, OriginHosts: rooms.OriginHosts(cfg.HTTP.CORSOrigins), Log: log,
	}
	mux := http.NewServeMux()
	routes := slices.Concat(server.Health(pool, version), socket.Routes())
	if err := server.Mount(mux, routes, auth.RateKey(cfg.HTTP.TrustedProxyHops), time.Now); err != nil {
		return err
	}
	return server.Serve(ctx, cfg.HTTP.Port, server.Stack(mux, log, cfg.HTTP.CORSOrigins, sessions), log)
}
