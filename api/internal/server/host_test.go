package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type upDB struct{}

func (upDB) Ping(context.Context) error { return nil }

type noObserver struct{}

func (noObserver) Observe(string, string, int, time.Duration) {}

const (
	apiHost = "api.trycommish.app"
	runApp  = "api-mgq3rq4xbq-ue.a.run.app"
	site    = "https://trycommish.app"
)

// stack is the whole middleware chain over the probes and one route, as
// a service serves it.
func stack() http.Handler {
	mux := http.NewServeMux()
	for _, rt := range Health(upDB{}, "test") {
		mux.Handle(rt.Pattern(), rt.Handler)
	}
	mux.HandleFunc("GET /me", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	return Stack(mux, slog.New(slog.NewTextHandler(io.Discard, nil)), noObserver{}, []string{site}, []string{apiHost})
}

// The stack answers the probes on any host and every other route only on
// the service's own host.
func TestStackKeepsTheProbesOpen(t *testing.T) {
	h := stack()
	cases := []struct {
		host, path string
		want       int
	}{
		{runApp, "/healthz", http.StatusOK},
		{runApp, "/readyz", http.StatusOK},
		{runApp, "/me", http.StatusNotFound},
		{apiHost, "/me", http.StatusNoContent},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, c.path, nil)
		r.Host = c.host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s%s = %d, want %d", c.host, c.path, w.Code, c.want)
		}
	}
}

// A CORS preflight from a listed origin is a 404 on the wrong host, with
// no CORS headers, and the usual 204 on the service's own host: the lock
// runs before CORS answers.
func TestStackLocksThePreflight(t *testing.T) {
	h := stack()
	for host, want := range map[string]int{runApp: http.StatusNotFound, apiHost: http.StatusNoContent} {
		r := httptest.NewRequest(http.MethodOptions, "/me", nil)
		r.Host = host
		r.Header.Set("Origin", site)
		r.Header.Set("Access-Control-Request-Method", http.MethodGet)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Errorf("preflight on %s = %d, want %d", host, w.Code, want)
		}
		if want == http.StatusNotFound && w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("preflight on %s carried CORS headers", host)
		}
		if w.Header().Get("X-Request-Id") == "" {
			t.Errorf("preflight on %s has no request id", host)
		}
	}
}
