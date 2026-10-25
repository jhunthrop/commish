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

// Devices is what Mount needs from auth.Bearer: rate keys read from the
// token alone, the middleware that resolves the device on a device
// route, and the app's way onto a session route (the session scope).
type Devices interface {
	RateKey(r *http.Request) string
	TokenKey(r *http.Request) (string, bool)
	Require(scope auth.Scope) httpx.Middleware
	SessionOr(signedIn, cookie http.Handler) http.Handler
}

// Mount registers routes on mux. Each route runs, in order: its name
// for the access log and the metrics, its rate limit, then the session
// lookup (an app's device token, else the cookie), then the session
// requirement. The limit comes before the lookup, so a flood costs no
// database read: its key is read from the token or the sealed cookie
// alone (or the address), never from a table.
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
		rateKey := sessions.RateKey
		if rt.Access.ResolvesSession() {
			// A device's session goes straight to the route: a cookie beside
			// its token is not read (no account swap, no CSRF check).
			route := h
			cookie := sessions.Middleware(route)
			h = cookie
			if devices != nil {
				h = devices.SessionOr(route, cookie)
			}
			// Only a SignedIn route is keyed by the token: a public route
			// (pairing, sign-in) stays on the address or cookie, so a
			// handful of old tokens buys no extra guesses there.
			if devices != nil && rt.Access == httpx.SignedIn {
				rateKey = tokenOr(devices, sessions)
			}
		}
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

// tokenOr keys a session route by the device token when one is sent, so
// an app behind a shared address is not limited by its neighbours, and
// by the cookie or the address otherwise.
func tokenOr(devices Devices, sessions Sessions) func(*http.Request) string {
	return func(r *http.Request) string {
		if key, ok := devices.TokenKey(r); ok {
			return key
		}
		return sessions.RateKey(r)
	}
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

// Stack wraps the mux in the middleware every request passes through,
// outermost first. The host lock answers a service's routes (the api's,
// the room's) only on hosts, and the probes on any: the service's run.app
// URL and its address get a 404 for everything else (httpx.AllowHosts),
// a CORS preflight included, since the lock runs before CORS. It runs
// after the request id and the access log, so its 404 is named and
// logged.
func Stack(mux http.Handler, log *slog.Logger, obs httpx.Observer, origins, hosts []string) http.Handler {
	return httpx.Chain(mux,
		httpx.RequestID(),
		httpx.Observe(log, obs),
		httpx.Recover(log),
		httpx.SecurityHeaders(),
		httpx.AllowHosts(hosts, livenessPath, readinessPath),
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
