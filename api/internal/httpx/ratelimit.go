package httpx

import (
	"math"
	"net"
	"net/http"
	"net/netip"
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

// PerMinute is n requests a minute.
func PerMinute(n int) Limit { return Limit{N: n, Per: time.Minute} }

// PerHour is n requests an hour.
func PerHour(n int) Limit { return Limit{N: n, Per: time.Hour} }

const (
	// limiterSweepEvery amortizes the idle sweep over many calls.
	limiterSweepEvery = 1024
	// limiterIdle is how long an unused bucket is kept.
	limiterIdle = 10 * time.Minute
	// limiterMaxKeys caps memory under a flood of distinct callers. At
	// the cap a new caller is never let through unlimited: it shares
	// one overflow bucket with every other caller that arrived at the
	// cap (see Limiter), so a flood of fresh addresses limits itself.
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
//
// The cap is explicit: at limiterMaxKeys live keys with none idle for a
// minute, every new key is charged to the one overflow bucket, which
// has the route's own limit. Under such a flood the callers who already
// hold a bucket keep it, and the flood shares one allowance. The limiter
// never fails open.
type Limiter struct {
	limit    Limit
	now      func() time.Time
	overflow *rate.Limiter

	mu      sync.Mutex
	buckets map[string]*bucket
	calls   uint64
}

func newBucket(l Limit) *rate.Limiter {
	return rate.NewLimiter(rate.Every(l.Per/time.Duration(l.N)), l.N)
}

// NewLimiter builds a limiter. now is the clock, injected so a test can
// freeze it.
func NewLimiter(l Limit, now func() time.Time) *Limiter {
	return &Limiter{limit: l, now: now, overflow: newBucket(l), buckets: map[string]*bucket{}}
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
			// Full with nothing idle: the shared overflow bucket.
			return l.overflow
		}
	}
	b := &bucket{lim: newBucket(l.limit), seen: now}
	l.buckets[key] = b
	return b.lim
}

// Allow spends one token for key, or reports how long until one is
// available.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.now()
	res := l.bucketFor(key, now).ReserveN(now, 1)
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

// ipv6KeyBits is the prefix an IPv6 caller is keyed by. One subscriber
// usually holds a whole /64, so keying full addresses would hand a
// single caller 2^64 buckets.
const ipv6KeyBits = 64

// AddressKey is the rate limit key for a client address: an IPv4
// address as it is, an IPv6 address by its /64.
func AddressKey(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	if p, err := addr.Prefix(ipv6KeyBits); err == nil {
		return p.String()
	}
	return addr.String()
}

// ClientIP resolves the caller's address, trusting exactly trustedHops
// proxies in front of the service (TRUSTED_PROXY_HOPS):
//
//   - api.trycommish.app served by Cloud Run directly (a DNS-only
//     record, today): Google's front end appends the client, so the
//     client is the last entry. trustedHops = 1.
//   - api.trycommish.app proxied by Cloudflare (orange cloud): Cloudflare
//     appends the client and Google's front end then appends the
//     Cloudflare edge, so the client is second from the right.
//     trustedHops = 2. Leaving it at 1 then would key every signed-out
//     caller by a Cloudflare edge address and bucket whole regions
//     together. The run.app URL must also be closed to direct traffic
//     (ingress internal and cloud load balancing, or a Cloudflare-only
//     allow list), or a caller could reach the service without
//     Cloudflare and choose its own second-from-right entry.
//
// The deploy sets it from the repository variable TRUSTED_PROXY_HOPS,
// so the cutover flips it without a code change. Every X-Forwarded-For line is joined
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
