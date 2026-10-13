// Package poll is the one polling discipline the host readers share (the
// live-draft companion, league sync): one upstream read per key per gap
// whatever the number of viewers, the last good read answered with how
// stale it is when the host fails, and a read cancelled when every viewer
// waiting on it has gone. The bound is per process: N instances serving
// one key make at most N reads a gap.
package poll

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// ErrNoRead is a key with no read and no failure to report: its only
// read was abandoned before it landed.
var ErrNoRead = errors.New("poll: no read yet")

// Mode is how a read past the gap answers.
type Mode int

const (
	// Wait has every viewer past the gap wait for the read upstream.
	Wait Mode = iota
	// Revalidate answers a key read before at once with that read while
	// one read goes upstream behind it; a key never read still waits.
	Revalidate
)

// Store keeps the last good read per key, so it survives a restart. Nil
// keeps nothing.
type Store[S any] interface {
	Last(ctx context.Context, key string) (S, time.Time, bool, error)
	Keep(ctx context.Context, key string, value S, at time.Time) error
}

// Read is a value, when it was read, and how stale it is: zero when this
// read reached the host or a read within the gap did; its age when the
// host failed since, or when it was kept from before this process and
// none has landed since. Err is the failure since, nil when none, so a
// reader can say why the value is stale.
type Read[S any] struct {
	Value S
	At    time.Time
	Stale time.Duration
	Err   error
}

// Fetch is one whole read upstream.
type Fetch[S any] func(ctx context.Context) (S, error)

type flight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	// abandoned is set when every waiter left and the read was cancelled
	// for that: it is no word about the host.
	abandoned bool
	// before is the entry's tried mark before this read, put back when
	// the read is abandoned, so it holds no gap.
	before time.Time
}

type entry[S any] struct {
	mu       sync.Mutex
	value    S
	has      bool
	at       time.Time
	stored   bool
	err      error
	tried    time.Time
	loaded   bool
	lastSeen time.Time
	inflight *flight
}

// Poller shares one upstream read per key between every viewer.
type Poller[S any] struct {
	Now   func() time.Time
	Store Store[S]
	Log   *slog.Logger
	// Idle drops a key no viewer has asked about in this long.
	Idle time.Duration
	// Timeout bounds a read nobody waits on.
	Timeout time.Duration
	// Outlive has a read run to its Timeout when every viewer waiting on
	// it has gone (the companion's reads, shared by a draft's viewers).
	// Without it the read is cancelled, and an abandoned read leaves no
	// trace: no error recorded, no gap held.
	Outlive bool

	mu       sync.Mutex
	entries  map[string]*entry[S]
	upstream int64
}

// Upstream is how many reads reached the host, for the measured cost.
func (p *Poller[S]) Upstream() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.upstream
}

// Holds reports whether this process has a read of the key.
func (p *Poller[S]) Holds(key string) bool {
	p.mu.Lock()
	e, ok := p.entries[key]
	p.mu.Unlock()
	if !ok {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.has
}

// Prime gives the key a read this process made outside Read (an attach
// that read the host as one member), so the next view answers it fresh
// and the gap counts from it.
func (p *Poller[S]) Prime(key string, value S, at time.Time) {
	e := p.entryFor(key, at)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.has && !at.After(e.at) {
		return
	}
	e.value, e.has, e.at, e.stored, e.err, e.tried, e.loaded = value, true, at, false, nil, at, true
}

func (p *Poller[S]) entryFor(key string, now time.Time) *entry[S] {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.entries == nil {
		p.entries = map[string]*entry[S]{}
	}
	for k, e := range p.entries {
		if k != key && p.Idle > 0 && now.Sub(e.lastSeen) > p.Idle {
			delete(p.entries, k)
		}
	}
	e, ok := p.entries[key]
	if !ok {
		e = &entry[S]{}
		p.entries[key] = e
	}
	e.lastSeen = now
	return e
}

// Read is the key as of at most gap ago.
func (p *Poller[S]) Read(ctx context.Context, key string, gap time.Duration, mode Mode, fetch Fetch[S]) (Read[S], error) {
	now := p.Now()
	e := p.entryFor(key, now)
	e.mu.Lock()
	p.warm(ctx, e, key)
	f := e.inflight
	if f != nil && f.abandoned {
		// Every viewer left that read and it was cancelled: it holds no
		// gap and is never joined, so this viewer sends its own.
		e.tried, e.inflight, f = f.before, nil, nil
	}
	switch {
	case f != nil:
	case !e.tried.IsZero() && now.Sub(e.tried) < gap:
		defer e.mu.Unlock()
		return e.answer(now, gap)
	case e.has && e.tried.IsZero() && now.Sub(e.at) < gap:
		defer e.mu.Unlock()
		return Read[S]{Value: e.value, At: e.at}, nil
	default:
		f = p.start(e, key, now, fetch)
	}
	if e.has && mode == Revalidate {
		defer e.mu.Unlock()
		return e.answer(now, gap)
	}
	f.waiters++
	e.mu.Unlock()
	select {
	case <-f.done:
	case <-ctx.Done():
		e.mu.Lock()
		f.waiters--
		if f.waiters == 0 && !p.Outlive {
			f.abandoned = true
			f.cancel()
		}
		e.mu.Unlock()
		var zero Read[S]
		return zero, ctx.Err()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.answer(p.Now(), gap)
}

// start sends one read upstream, with e locked.
func (p *Poller[S]) start(e *entry[S], key string, now time.Time, fetch Fetch[S]) *flight {
	ctx, cancel := context.WithTimeout(context.Background(), p.Timeout)
	f := &flight{done: make(chan struct{}), cancel: cancel, before: e.tried}
	e.inflight, e.tried = f, now
	p.mu.Lock()
	p.upstream++
	p.mu.Unlock()
	go func() {
		defer cancel()
		value, err := fetch(ctx)
		e.mu.Lock()
		current := e.inflight == f
		switch {
		case err != nil && f.abandoned:
			if current {
				e.tried = f.before
			}
		case err != nil:
			e.err = err
		default:
			e.value, e.has, e.at, e.err, e.stored = value, true, now, nil, false
		}
		if current {
			e.inflight = nil
		}
		close(f.done)
		e.mu.Unlock()
		if err == nil && p.Store != nil {
			p.keep(key, value, now)
		}
	}()
	return f
}

// keep stores a good read, on its own deadline: the read's may be spent.
func (p *Poller[S]) keep(key string, value S, at time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), p.Timeout)
	defer cancel()
	if err := p.Store.Keep(ctx, key, value, at); err != nil {
		p.Log.Warn("poll: keep", "key", key, "err", err)
	}
}

// warm loads the kept read the first time a key is asked about in this
// process. A failed load is tried again by the next viewer.
func (p *Poller[S]) warm(ctx context.Context, e *entry[S], key string) {
	if e.loaded || p.Store == nil {
		e.loaded = true
		return
	}
	value, at, ok, err := p.Store.Last(context.WithoutCancel(ctx), key)
	if err != nil {
		p.Log.Warn("poll: kept read", "key", key, "err", err)
		return
	}
	e.loaded = true
	if ok {
		e.value, e.has, e.at, e.stored = value, true, at, true
	}
}

// answer is the entry's last read with its staleness, or its last error,
// with e locked.
func (e *entry[S]) answer(now time.Time, gap time.Duration) (Read[S], error) {
	if !e.has {
		var zero Read[S]
		if e.err == nil {
			return zero, ErrNoRead
		}
		return zero, e.err
	}
	r := Read[S]{Value: e.value, At: e.at, Err: e.err}
	age := now.Sub(e.at)
	if e.err != nil || (e.stored && age >= gap) {
		r.Stale = age
	}
	return r, nil
}
