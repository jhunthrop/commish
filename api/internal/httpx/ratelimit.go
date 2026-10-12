package httpx

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limit is one route's token bucket: N requests per Per, with a burst
// of N, so a fresh caller may spend the whole allowance at once and the
// bucket then refills evenly.
type Limit struct {
	N   int
	Per time.Duration
}

const (
	// limiterSweepEvery amortizes the idle sweep over many calls.
	limiterSweepEvery = 1024
	// limiterIdle is how long an unused bucket is kept.
	limiterIdle = 10 * time.Minute
	// limiterMaxKeys caps memory under a flood of distinct callers.
	limiterMaxKeys = 20000
	// limiterPressureIdle is the shorter idle window used at the cap.
	limiterPressureIdle = time.Minute
)

type bucket struct {
	lim  *rate.Limiter
	seen time.Time
}

// Limiter holds one token bucket per key for one route. A Cloud Run
// instance limits only what reaches it; with several instances a
// caller's real allowance is N times the instance count, which the
// limits are set with in mind.
type Limiter struct {
	limit Limit
	now   func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
	calls   uint64
}

// NewLimiter builds a limiter. now is the clock, injected so a test can
// freeze it.
func NewLimiter(l Limit, now func() time.Time) *Limiter {
	return &Limiter{limit: l, now: now, buckets: map[string]*bucket{}}
}

func (l *Limiter) sweepLocked(now time.Time, idle time.Duration) {
	for k, b := range l.buckets {
		if now.Sub(b.seen) > idle {
			delete(l.buckets, k)
		}
	}
}

func (l *Limiter) bucketFor(key string, now time.Time) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls++
	if l.calls%limiterSweepEvery == 0 {
		l.sweepLocked(now, limiterIdle)
	}
	if b, ok := l.buckets[key]; ok {
		b.seen = now
		return b.lim
	}
	if len(l.buckets) >= limiterMaxKeys {
		l.sweepLocked(now, limiterPressureIdle)
		if len(l.buckets) >= limiterMaxKeys {
			// Full with nothing idle: let the request through untracked
			// rather than refuse real traffic or grow without bound.
			return nil
		}
	}
	every := rate.Every(l.limit.Per / time.Duration(l.limit.N))
	b := &bucket{lim: rate.NewLimiter(every, l.limit.N), seen: now}
	l.buckets[key] = b
	return b.lim
}

// Allow spends one token for key, or reports how long until one is
// available.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.now()
	lim := l.bucketFor(key, now)
	if lim == nil {
		return true, 0
	}
	res := lim.ReserveN(now, 1)
	if !res.OK() {
		return false, l.limit.Per
	}
	if d := res.DelayFrom(now); d > 0 {
		res.CancelAt(now)
		return false, d
	}
	return true, 0
}

// RateLimit answers 429 with Retry-After once key's bucket is empty.
func RateLimit(l *Limiter, keyOf func(*http.Request) string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, wait := l.Allow(keyOf(r))
			if !ok {
				secs := int(math.Ceil(wait.Seconds()))
				w.Header().Set("Retry-After", strconv.Itoa(max(secs, 1)))
				WriteError(w, r, http.StatusTooManyRequests, CodeRateLimited, "Too many requests, try again shortly", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientIP resolves the caller's address, trusting exactly trustedHops
// proxies in front of the service. Every X-Forwarded-For line is joined
// before counting from the right, because a client can send its own
// lines ahead of the one the trusted proxy appends. With too few
// entries the header is untrusted and RemoteAddr is used.
func ClientIP(r *http.Request, trustedHops int) string {
	if trustedHops > 0 {
		if xff := strings.Join(r.Header.Values("X-Forwarded-For"), ","); xff != "" {
			hops := strings.Split(xff, ",")
			if len(hops) >= trustedHops {
				return strings.TrimSpace(hops[len(hops)-trustedHops])
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
