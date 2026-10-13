package httpx

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// gzipWriters reuses compressors: a room's board is a few hundred
// kilobytes of JSON and a pick's answer a few, every one compressed.
var gzipWriters = sync.Pool{New: func() any {
	w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
	return w
}}

// Gzip compresses JSON answers for a client that accepts it. A WebSocket
// upgrade and every other content type pass through untouched.
func Gzip() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Upgrade") != "" || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Add("Vary", "Accept-Encoding")
			gw := &gzipWriter{ResponseWriter: w}
			defer gw.close()
			next.ServeHTTP(gw, r)
		})
	}
}

type gzipWriter struct {
	http.ResponseWriter
	gz      *gzip.Writer
	decided bool
}

func (g *gzipWriter) decide(status int) {
	g.decided = true
	h := g.Header()
	if status == http.StatusNoContent || status == http.StatusNotModified || h.Get("Content-Encoding") != "" ||
		!strings.HasPrefix(h.Get("Content-Type"), "application/json") {
		return
	}
	h.Del("Content-Length")
	h.Set("Content-Encoding", "gzip")
	g.gz = gzipWriters.Get().(*gzip.Writer)
	g.gz.Reset(g.ResponseWriter)
}

func (g *gzipWriter) WriteHeader(status int) {
	if !g.decided {
		g.decide(status)
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipWriter) Write(b []byte) (int, error) {
	if !g.decided {
		g.WriteHeader(http.StatusOK)
	}
	if g.gz != nil {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func (g *gzipWriter) close() {
	if g.gz == nil {
		return
	}
	_ = g.gz.Close()
	gzipWriters.Put(g.gz)
	g.gz = nil
}

func (g *gzipWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }
