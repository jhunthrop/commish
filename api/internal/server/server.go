// Package server composes the middleware and mounts every package's
// routes, one way for both commands: each route gets its own rate
// limit, its access rule and its name in the access log.
package server

import (
	"context"
	"errors"
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

// The probe paths: Cloud Run's own checks, open on every host.
const (
	livenessPath  = "/healthz"
	readinessPath = "/readyz"
)

const (
	limitHealthPerMinute   = 600
	limitNotFoundPerMinute = 120
)

// Pinger is the database, as readiness sees it.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Sessions is what Mount needs from auth.Sessions: a rate key read from
// the cookie alone, and the middleware that resolves the account.
type Sessions interface {
	RateKey(r *http.Request) string
	Middleware(next http.Handler) http.Handler
}

// Devices is what Mount needs from auth.Bearer: a rate key read from
// the token alone, and the middleware that resolves the device.
type Devices interface {
	RateKey(r *http.Request) string
	Require(scope auth.Scope) httpx.Middleware
}

// Mount registers routes on mux. Each route runs, in order: its name
// for the access log and the metrics, its rate limit, then the session
// lookup, then the session requirement. The limit comes before the
// lookup, so a flood costs no database read: its key is read from the
// sealed cookie alone (or the address), never from the sessions table.
// A route without a limit is a programming error and refuses to mount,
// so no endpoint ships unlimited, and so is a device route without a
// scope or without devices to resolve it.
func Mount(mux *http.ServeMux, routes []httpx.Route, sessions Sessions, devices Devices, now func() time.Time) error {
	for _, rt := range routes {
		if rt.Limit.N <= 0 || rt.Limit.Per <= 0 {
			return fmt.Errorf("server: route %s has no rate limit", rt.Pattern())
		}
		if rt.Access == httpx.Device && (rt.Scope == "" || devices == nil) {
			return fmt.Errorf("server: device route %s has no scope or no devices", rt.Pattern())
		}
		var h http.Handler = rt.Handler
		if rt.Access == httpx.SignedIn {
			h = auth.RequireSession(h)
		}
		if rt.Access.ResolvesSession() {
			h = sessions.Middleware(h)
		}
		rateKey := sessions.RateKey
		if rt.Access == httpx.Device {
			h = devices.Require(auth.Scope(rt.Scope))(h)
			rateKey = devices.RateKey
		}
		h = httpx.RateLimit(httpx.NewLimiter(rt.Limit, now), rateKey)(h)
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
		{Method: http.MethodGet, Path: livenessPath, Access: httpx.Anonymous, Limit: httpx.PerMinute(limitHealthPerMinute),
			Handler: func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteOK(w, r, http.StatusOK, health(apitypes.HealthStatusOk))
			}},
		{Method: http.MethodGet, Path: readinessPath, Access: httpx.Anonymous, Limit: httpx.PerMinute(limitHealthPerMinute),
			Handler: func(w http.ResponseWriter, r *http.Request) {
				ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
				defer cancel()
				if err := db.Ping(ctx); err != nil {
					httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "The database is not reachable", nil)
					return
				}
				httpx.WriteOK(w, r, http.StatusOK, health(apitypes.HealthStatusOk))
			}},
		{Method: "", Path: "/", Access: httpx.Anonymous, Limit: httpx.PerMinute(limitNotFoundPerMinute),
			Handler: func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "No route here", nil)
			}},
	}
}

// LockHosts answers the API's routes only on hosts (or a loopback host),
// and the probes on any: the service's run.app URL and its address get
// a 404 for everything else (httpx.AllowHosts).
func LockHosts(h http.Handler, hosts []string) http.Handler {
	return httpx.AllowHosts(hosts, livenessPath, readinessPath)(h)
}

// Stack wraps the mux in the middleware every request passes through,
// outermost first.
func Stack(mux http.Handler, log *slog.Logger, obs httpx.Observer, origins []string) http.Handler {
	return httpx.Chain(mux,
		httpx.RequestID(),
		httpx.Observe(log, obs),
		httpx.Recover(log),
		httpx.SecurityHeaders(),
		httpx.CORS(origins),
		httpx.Gzip(),
	)
}

// Run serves public on port and internal (the metrics) on
// internalPort until ctx ends or either listener fails, then stops
// both. Cloud Run routes only PORT from outside, so the internal
// listener is never public.
func Run(ctx context.Context, log *slog.Logger, port string, public http.Handler, internalPort string, internal http.Handler) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errs := make(chan error, 2)
	go func() { errs <- Serve(ctx, port, public, log) }()
	go func() { errs <- Serve(ctx, internalPort, internal, log.With("listener", "internal")) }()
	first := <-errs
	cancel()
	return errors.Join(first, <-errs)
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
