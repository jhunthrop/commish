package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The API answers its routes only on the hosts it is given; any other
// host (its run.app URL, a bare IP, a loopback name production never
// lists) is a 404 in the envelope, except the probe paths, which stay open
// on every host.
func TestAllowHosts(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := AllowHosts([]string{"api.trycommish.app"}, "/healthz", "/readyz")(ok)
	cases := []struct {
		name, host, path string
		want             int
	}{
		{"the api host", "api.trycommish.app", "/me", http.StatusTeapot},
		{"the api host with a port", "api.trycommish.app:443", "/me", http.StatusTeapot},
		{"the api host in capitals", "API.TryCommish.App", "/me", http.StatusTeapot},
		{"localhost unlisted", "localhost:8080", "/me", http.StatusNotFound},
		{"loopback v4 unlisted", "127.0.0.1:8080", "/me", http.StatusNotFound},
		{"loopback v6 unlisted", "[::1]:8080", "/me", http.StatusNotFound},
		{"the run.app url", "api-mgq3rq4xbq-ue.a.run.app", "/me", http.StatusNotFound},
		{"the run.app url at the root", "api-mgq3rq4xbq-ue.a.run.app", "/", http.StatusNotFound},
		{"an ip", "34.1.2.3", "/me", http.StatusNotFound},
		{"a suffix of the api host", "evil-api.trycommish.app", "/me", http.StatusNotFound},
		{"no host", "", "/me", http.StatusNotFound},
		{"liveness on the run.app url", "api-mgq3rq4xbq-ue.a.run.app", "/healthz", http.StatusTeapot},
		{"readiness on an ip", "10.0.0.1", "/readyz", http.StatusTeapot},
		{"a probe-like prefix stays locked", "10.0.0.1", "/healthz/x", http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, c.path, nil)
			r.Host = c.host
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != c.want {
				t.Fatalf("status = %d, want %d", w.Code, c.want)
			}
			if c.want == http.StatusNotFound && !strings.Contains(w.Body.String(), `"`+CodeNotFound+`"`) {
				t.Fatalf("not the envelope: %s", w.Body.String())
			}
		})
	}
}

// The check reads the request's own Host, never a forwarded one: the API
// is not behind a proxy that would set it, so a caller could forge it.
func TestAllowHostsIgnoresForwardedHost(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := AllowHosts([]string{"api.trycommish.app"})(ok)
	r := httptest.NewRequest(http.MethodGet, "/me", nil)
	r.Host = "api-mgq3rq4xbq-ue.a.run.app"
	r.Header.Set("X-Forwarded-Host", "api.trycommish.app")
	r.Header.Set("Forwarded", "host=api.trycommish.app")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("a forwarded host was trusted: %d", w.Code)
	}
}

// A listed IPv6 loopback matches with its port and brackets, the way a
// development list names it.
func TestAllowHostsListedLoopback(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := AllowHosts([]string{"localhost", "127.0.0.1", "::1"})(ok)
	for _, host := range []string{"localhost:8080", "127.0.0.1:8080", "[::1]:8080"} {
		r := httptest.NewRequest(http.MethodGet, "/me", nil)
		r.Host = host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusTeapot {
			t.Fatalf("%s = %d", host, w.Code)
		}
	}
}
