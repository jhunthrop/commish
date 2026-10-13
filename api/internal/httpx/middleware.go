package httpx

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"slices"
	"time"
)

// Middleware wraps a handler.
type Middleware func(http.Handler) http.Handler

// Chain applies mws so the first listed runs first.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// requestIDShape is what an inbound X-Request-Id must look like to be
// trusted into the logs; anything else is replaced.
var requestIDShape = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestID stamps every request with an id, echoed in the envelope,
// the logs and the X-Request-Id header.
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-Id")
			if !requestIDShape.MatchString(id) {
				b := make([]byte, 8)
				_, _ = rand.Read(b)
				id = hex.EncodeToString(b)
			}
			w.Header().Set("X-Request-Id", id)
			next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Hijack hands the connection to a WebSocket upgrade: the room socket's
// library asserts http.Hijacker on the writer it is given. The upgrade
// is logged as 101.
func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := http.NewResponseController(s.ResponseWriter).Hijack()
	if err == nil {
		s.status = http.StatusSwitchingProtocols
	}
	return conn, rw, err
}

// routeInfo is filled in by the route wrapper (see Mount), so the
// access log can name the route pattern rather than the raw path,
// which is what a per-route latency measurement groups by.
type routeInfo struct{ pattern string }

// Observer records one finished request: the metrics registry.
type Observer interface {
	Observe(method, route string, status int, elapsed time.Duration)
}

// unmatchedRoute names a request no route pattern claimed.
const unmatchedRoute = "unmatched"

// routeOf is the request's matched route pattern, never its raw path.
func routeOf(info *routeInfo) string {
	if info == nil || info.pattern == "" {
		return unmatchedRoute
	}
	return info.pattern
}

// Observe writes one structured line per request and hands the same
// facts to obs. The line names the route pattern ("GET
// /group-passes/{code}"), never the raw path, and never a query string,
// a header or a body: a claim code, a token or an id in a path segment
// cannot reach the logs through it.
func Observe(log *slog.Logger, obs Observer) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			info := &routeInfo{}
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r.WithContext(withRoute(r.Context(), info)))
			elapsed := time.Since(start)
			route := routeOf(info)
			obs.Observe(r.Method, route, sw.status, elapsed)
			log.Info("request",
				"request_id", RequestIDFrom(r.Context()), "method", r.Method, "route", route,
				"status", sw.status, "bytes", sw.bytes, "ms", float64(elapsed.Microseconds())/1000)
		})
	}
}

// Recover turns a panic into a logged 500 so one bad request never
// takes the process down.
func Recover(log *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					info, _ := r.Context().Value(routeKey).(*routeInfo)
					log.Error("panic", "request_id", RequestIDFrom(r.Context()), "route", routeOf(info), "panic", rec)
					WriteError(w, r, http.StatusInternalServerError, CodeInternal, "Something went wrong on our side", nil)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders marks every answer as not for sniffing, framing or
// shared caching. The API serves only JSON and redirects.
func SecurityHeaders() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
		})
	}
}

// CORS headers. Credentials are allowed because the session cookie is
// on the apex domain and the site is a different origin from the API.
const (
	corsMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
	corsHeaders = "Content-Type, X-CSRF-Token, X-Request-Id"
	corsMaxAge  = "600"
)

// CORS allows exactly the listed origins, never a wildcard.
func CORS(origins []string) Middleware {
	allowed := slices.Clone(origins)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			w.Header().Add("Vary", "Origin")
			ok := origin != "" && slices.Contains(allowed, origin)
			if ok {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
			}
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				if ok {
					h := w.Header()
					h.Set("Access-Control-Allow-Methods", corsMethods)
					h.Set("Access-Control-Allow-Headers", corsHeaders)
					h.Set("Access-Control-Max-Age", corsMaxAge)
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
