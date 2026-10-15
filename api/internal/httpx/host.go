package httpx

import (
	"net"
	"net/http"
	"slices"
	"strings"
)

// HostName is a Host header's name alone: lower-cased, the port and an
// IPv6 literal's brackets taken off.
func HostName(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.ToLower(strings.Trim(host, "[]"))
}

// loopback reports whether a host name is this machine: localhost, or a
// loopback address. Cloud Run's front end routes by the Host it is sent,
// so no outside caller reaches the service with one of these.
func loopback(name string) bool {
	if name == "localhost" {
		return true
	}
	ip := net.ParseIP(name)
	return ip != nil && ip.IsLoopback()
}

// AllowHosts answers 404, in the envelope, for every request whose Host
// is neither one of hosts nor a loopback one, except the exact paths in
// open (the probes, which Cloud Run sends to the container on any host).
// It reads r.Host alone, never X-Forwarded-Host or Forwarded: nothing in
// front of the API sets them, so a caller could. This is what keeps the
// service's run.app URL and its address from answering the API's routes.
func AllowHosts(hosts []string, open ...string) Middleware {
	allowed := make([]string, 0, len(hosts))
	for _, h := range hosts {
		allowed = append(allowed, HostName(h))
	}
	openPaths := slices.Clone(open)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := HostName(r.Host)
			if slices.Contains(allowed, name) || loopback(name) || slices.Contains(openPaths, r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			WriteError(w, r, http.StatusNotFound, CodeNotFound, "No route here", nil)
		})
	}
}
