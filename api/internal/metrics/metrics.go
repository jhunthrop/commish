// Package metrics counts requests and their latency per route, the
// measurement spec §5 asks of the API (p90 under 100 ms for every read).
//
// It records OpenTelemetry's http.server.request.duration histogram
// (seconds, with http.request.method, http.route and
// http.response.status_code) and serves it in the Prometheus text
// format, the same names OpenTelemetry's Prometheus exporter writes
// (http_server_request_duration_seconds with _bucket, _sum and _count;
// _count is the request counter). It is served on its own internal port,
// never on the public one. Labels are route patterns, never raw paths,
// so the series count is bounded by the route table.
package metrics

import (
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// metricName is http.server.request.duration in Prometheus form.
const metricName = "http_server_request_duration_seconds"

// bucketBounds are OpenTelemetry's recommended boundaries for
// http.server.request.duration, in seconds.
func bucketBounds() []float64 {
	return []float64{0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10}
}

type series struct {
	method, route string
	status        int
}

type histogram struct {
	counts []uint64 // one per bound, plus +Inf at the end
	sum    float64
	count  uint64
}

// Registry is every series since the process started.
type Registry struct {
	bounds []float64

	mu     sync.Mutex
	series map[series]*histogram
}

// New builds an empty registry.
func New() *Registry {
	return &Registry{bounds: bucketBounds(), series: map[series]*histogram{}}
}

// Observe records one request. It satisfies httpx.Observer.
func (r *Registry) Observe(method, route string, status int, elapsed time.Duration) {
	// A ServeMux pattern carries its method ("GET /me"); http.route is
	// the path template alone, the method has its own label.
	if _, path, ok := strings.Cut(route, " "); ok {
		route = path
	}
	secs := elapsed.Seconds()
	key := series{method: method, route: route, status: status}
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.series[key]
	if !ok {
		h = &histogram{counts: make([]uint64, len(r.bounds)+1)}
		r.series[key] = h
	}
	i, _ := slices.BinarySearch(r.bounds, secs)
	h.counts[i]++
	h.sum += secs
	h.count++
}

func formatFloat(f float64) string { return strconv.FormatFloat(f, 'g', -1, 64) }

func escape(v string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(v)
}

// WriteText writes every series in the Prometheus text format.
func (r *Registry) WriteText(w io.Writer) error {
	r.mu.Lock()
	keys := make([]series, 0, len(r.series))
	snap := make(map[series]histogram, len(r.series))
	for k, h := range r.series {
		keys = append(keys, k)
		snap[k] = histogram{counts: slices.Clone(h.counts), sum: h.sum, count: h.count}
	}
	r.mu.Unlock()
	slices.SortFunc(keys, func(a, b series) int {
		return strings.Compare(fmt.Sprint(a.route, a.method, a.status), fmt.Sprint(b.route, b.method, b.status))
	})
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP %s Duration of HTTP server requests.\n# TYPE %s histogram\n", metricName, metricName)
	for _, k := range keys {
		h := snap[k]
		labels := fmt.Sprintf(`http_request_method="%s",http_route="%s",http_response_status_code="%d"`,
			escape(k.method), escape(k.route), k.status)
		var cum uint64
		for i, bound := range r.bounds {
			cum += h.counts[i]
			fmt.Fprintf(&b, "%s_bucket{%s,le=\"%s\"} %d\n", metricName, labels, formatFloat(bound), cum)
		}
		fmt.Fprintf(&b, "%s_bucket{%s,le=\"+Inf\"} %d\n", metricName, labels, h.count)
		fmt.Fprintf(&b, "%s_sum{%s} %s\n", metricName, labels, formatFloat(h.sum))
		fmt.Fprintf(&b, "%s_count{%s} %d\n", metricName, labels, h.count)
	}
	_, err := io.WriteString(w, b.String())
	return err
}

// Handler serves GET /metrics.
func (r *Registry) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_ = r.WriteText(w)
	})
	return mux
}
