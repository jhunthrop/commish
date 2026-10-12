// Package server composes the middleware and mounts every package's
// routes, one way for both commands: each route gets its own rate
// limit, its access rule and its name in the access log.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Timeouts for the HTTP server. net/http clears a connection's
// deadlines when a WebSocket hijacks it, so these never cut a live room.
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 60 * time.Second
	idleTimeout       = 120 * time.Second
	pingTimeout       = 2 * time.Second
	shutdownTimeout   = 10 * time.Second
)

var (
	limitHealth   = httpx.Limit{N: 600, Per: time.Minute}
	limitNotFound = httpx.Limit{N: 120, Per: time.Minute}
)

// Pinger is the database, as readiness sees it.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Mount registers routes on mux. A route without a limit is a
// programming error and refuses to mount, so no endpoint ships
// unlimited.
func Mount(mux *http.ServeMux, routes []httpx.Route, keyOf func(*http.Request) string, now func() time.Time) error {
	for _, rt := range routes {
		if rt.Limit.N <= 0 || rt.Limit.Per <= 0 {
			return fmt.Errorf("server: route %s has no rate limit", rt.Pattern())
		}
		var h http.Handler = rt.Handler
		if rt.Access == httpx.SignedIn {
			h = auth.RequireSession(h)
		}
		h = httpx.RateLimit(httpx.NewLimiter(rt.Limit, now), keyOf)(h)
		h = httpx.NameRoute(rt.Pattern())(h)
		mux.Handle(rt.Pattern(), h)
	}
	return nil
}

// Health is liveness, readiness and the catch-all 404.
func Health(db Pinger, version string) []httpx.Route {
	health := func(status apitypes.HealthStatus) apitypes.Health {
		return apitypes.Health{Status: status, Version: version}
	}
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/healthz", Access: httpx.Public, Limit: limitHealth,
			Handler: func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteOK(w, r, http.StatusOK, health(apitypes.HealthStatusOk))
			}},
		{Method: http.MethodGet, Path: "/readyz", Access: httpx.Public, Limit: limitHealth,
			Handler: func(w http.ResponseWriter, r *http.Request) {
				ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
				defer cancel()
				if err := db.Ping(ctx); err != nil {
					httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "The database is not reachable", nil)
					return
				}
				httpx.WriteOK(w, r, http.StatusOK, health(apitypes.HealthStatusOk))
			}},
		{Method: "", Path: "/", Access: httpx.Public, Limit: limitNotFound,
			Handler: func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "No route here", nil)
			}},
	}
}

// Stack wraps the mux in the middleware every request passes through,
// outermost first.
func Stack(mux http.Handler, log *slog.Logger, origins []string, sessions *auth.Sessions) http.Handler {
	return httpx.Chain(mux,
		httpx.RequestID(),
		httpx.Logger(log),
		httpx.Recover(log),
		httpx.SecurityHeaders(),
		httpx.CORS(origins),
		sessions.Middleware,
	)
}

// Serve runs handler on port until ctx ends, then drains for up to
// shutdownTimeout.
func Serve(ctx context.Context, port string, handler http.Handler, log *slog.Logger) error {
	srv := &http.Server{
		Addr: ":" + port, Handler: handler,
		ReadHeaderTimeout: readHeaderTimeout, ReadTimeout: readTimeout,
		WriteTimeout: writeTimeout, IdleTimeout: idleTimeout,
	}
	errs := make(chan error, 1)
	go func() { errs <- srv.ListenAndServe() }()
	log.Info("listening", "port", port)
	select {
	case err := <-errs:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("server: shutdown: %w", err)
	}
	return nil
}
