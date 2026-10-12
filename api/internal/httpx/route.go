package httpx

import (
	"context"
	"net/http"
)

// Access is who may call a route.
type Access int

const (
	// Public routes answer anyone, signed in or not.
	Public Access = iota
	// SignedIn routes answer 401 without a session.
	SignedIn
	// Webhook routes are public and exempt from the CSRF check, because
	// the caller is a server that signs its body instead. No session is
	// resolved for them.
	Webhook
	// Anonymous routes never resolve a session: the health probes, which
	// must not touch the database, and the catch-all 404.
	Anonymous
)

// ResolvesSession reports whether the route looks up the caller's
// session before its handler runs.
func (a Access) ResolvesSession() bool { return a != Webhook && a != Anonymous }

// Route is one endpoint with its access rule and its rate limit. Every
// package declares its routes as a list of these, so the whole surface,
// with its limits, reads in one place per package and is mounted by one
// function (internal/server).
type Route struct {
	Method  string
	Path    string
	Access  Access
	Limit   Limit
	Handler http.HandlerFunc
}

// Pattern is the ServeMux pattern, "GET /sheets/{id}", or the bare path
// for a route that answers every method.
func (rt Route) Pattern() string {
	if rt.Method == "" {
		return rt.Path
	}
	return rt.Method + " " + rt.Path
}

func withRoute(ctx context.Context, info *routeInfo) context.Context {
	return context.WithValue(ctx, routeKey, info)
}

// NameRoute records the matched pattern for the access log.
func NameRoute(pattern string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if info, ok := r.Context().Value(routeKey).(*routeInfo); ok {
				info.pattern = pattern
			}
			next.ServeHTTP(w, r)
		})
	}
}
