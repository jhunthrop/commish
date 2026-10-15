package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type upDB struct{}

func (upDB) Ping(context.Context) error { return nil }

// The locked handler answers the probes on any host and every other
// route only on the API's own host.
func TestLockHostsKeepsTheProbesOpen(t *testing.T) {
	mux := http.NewServeMux()
	for _, rt := range Health(upDB{}, "test") {
		mux.Handle(rt.Pattern(), rt.Handler)
	}
	mux.HandleFunc("GET /me", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	h := LockHosts(mux, []string{"api.trycommish.app"})
	const runApp = "api-mgq3rq4xbq-ue.a.run.app"
	cases := []struct {
		host, path string
		want       int
	}{
		{runApp, "/healthz", http.StatusOK},
		{runApp, "/readyz", http.StatusOK},
		{runApp, "/me", http.StatusNotFound},
		{"api.trycommish.app", "/me", http.StatusNoContent},
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
