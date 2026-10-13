package leaguesync

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Polling discipline (spec §2.9, the companion's, at a league's pace):
// one upstream read per league per minute whatever the number of
// viewers, since rosters change slowly; a deliberate refresh may read
// sooner, but never twice inside RefreshFloor; the last good read is
// answered with its age when the host fails, and a linked league's
// survives a restart through the store. The bound is per process: N
// instances serving one league make at most N reads a minute.
//
// A read is cancelled when every viewer waiting on it has gone; a read
// nobody waits on (the one behind a view answered from the last read)
// runs at most ReadTimeout.
const (
	MinUpstreamGap = time.Minute
	RefreshFloor   = 10 * time.Second
	ReadTimeout    = 30 * time.Second
	// idleAfter drops a league no viewer has asked about in this long.
	idleAfter = 30 * time.Minute
)

// SnapshotStore keeps the last good read per host league. PutSnapshot
// keeps nothing for a league no account has linked.
type SnapshotStore interface {
	LastSnapshot(ctx context.Context, ref Ref) (Snapshot, bool, error)
	PutSnapshot(ctx context.Context, snap Snapshot) error
}

// Read is a snapshot and how stale it is: zero when this read reached
// the host or a read within the gap did; the age of the last good read
// when the host failed since, or when the read is one kept from before
// this process and none has landed since.
type Read struct {
	Snapshot
	Stale time.Duration
}

// flight is one read upstream and the viewers waiting on it.
type flight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
}

type pollEntry struct {
	mu       sync.Mutex
	snap     *Snapshot
	stored   bool
	err      error
	tried    time.Time
	loaded   bool
	lastSeen time.Time
	inflight *flight
}

// Poller shares one upstream read per league between every viewer.
type Poller struct {
	Hosts Hosts
	Store SnapshotStore
	Now   func() time.Time
	Log   *slog.Logger

	mu       sync.Mutex
	entries  map[string]*pollEntry
	upstream int64
}

// Upstream is how many whole reads reached a host, for the measured poll
// cost.
func (p *Poller) Upstream() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.upstream
}

// Holds reports whether this process has a read of the league, so a
// view of it costs the host nothing new.
func (p *Poller) Holds(ref Ref) bool {
	p.mu.Lock()
	e, ok := p.entries[ref.Key()]
	p.mu.Unlock()
	if !ok {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.snap != nil
}

func (p *Poller) entryFor(key string, now time.Time) *pollEntry {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.entries == nil {
		p.entries = map[string]*pollEntry{}
	}
	for k, e := range p.entries {
		if k != key && now.Sub(e.lastSeen) > idleAfter {
			delete(p.entries, k)
		}
	}
	e, ok := p.entries[key]
	if !ok {
		e = &pollEntry{}
		p.entries[key] = e
	}
	e.lastSeen = now
	return e
}

// Read is the league as of at most MinUpstreamGap ago. Past the gap,
// a league read before answers that read at once while one read goes
// upstream behind it; only a league never read waits for the host.
func (p *Poller) Read(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, MinUpstreamGap, false)
}

// Refresh is the league read again now, waiting for the host, unless a
// read went upstream inside RefreshFloor, which it shares.
func (p *Poller) Refresh(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, RefreshFloor, true)
}

func (p *Poller) read(ctx context.Context, ref Ref, gap time.Duration, waitFresh bool) (Read, error) {
	host, ok := p.Hosts.ByKey(ref.Host)
	if !ok {
		return Read{}, ErrNotALink
	}
	now := p.Now()
	e := p.entryFor(ref.Key(), now)
	e.mu.Lock()
	p.warm(ctx, e, ref)
	f := e.inflight
	switch {
	case f != nil:
	case !e.tried.IsZero() && now.Sub(e.tried) < gap:
		defer e.mu.Unlock()
		return p.cached(e, now, gap)
	case e.snap != nil && e.tried.IsZero() && now.Sub(e.snap.ReadAt) < gap:
		// A stored read from before this process that is still fresh.
		defer e.mu.Unlock()
		return Read{Snapshot: *e.snap}, nil
	default:
		f = p.start(e, host, ref, now)
	}
	if e.snap != nil && !waitFresh {
		defer e.mu.Unlock()
		return p.cached(e, now, gap)
	}
	f.waiters++
	e.mu.Unlock()
	select {
	case <-f.done:
	case <-ctx.Done():
		e.mu.Lock()
		f.waiters--
		if f.waiters == 0 {
			f.cancel()
		}
		e.mu.Unlock()
		return Read{}, ctx.Err()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return p.cached(e, p.Now(), gap)
}

// start sends one read upstream for every viewer, with e locked.
func (p *Poller) start(e *pollEntry, host Host, ref Ref, now time.Time) *flight {
	ctx, cancel := context.WithTimeout(context.Background(), ReadTimeout)
	f := &flight{done: make(chan struct{}), cancel: cancel}
	e.inflight, e.tried = f, now
	p.mu.Lock()
	p.upstream++
	p.mu.Unlock()
	go func() {
		defer cancel()
		snap, err := host.Read(ctx, ref)
		e.mu.Lock()
		if err != nil {
			e.err = err
		} else {
			snap.ReadAt = now
			e.snap, e.err, e.stored = &snap, nil, false
		}
		e.inflight = nil
		close(f.done)
		e.mu.Unlock()
		if err == nil {
			p.Keep(snap)
		}
	}()
	return f
}

// Keep stores a good read; the store keeps it only for a linked league,
// so an attach keeps its read once the link is written.
func (p *Poller) Keep(snap Snapshot) {
	ctx, cancel := context.WithTimeout(context.Background(), ReadTimeout)
	defer cancel()
	if err := p.Store.PutSnapshot(ctx, snap); err != nil {
		p.Log.Warn("leaguesync: keep snapshot", "league", snap.Ref.Key(), "err", err)
	}
}

// warm loads the stored read the first time a league is asked about in
// this process. A failed load is tried again by the next viewer.
func (p *Poller) warm(ctx context.Context, e *pollEntry, ref Ref) {
	if e.loaded {
		return
	}
	snap, ok, err := p.Store.LastSnapshot(context.WithoutCancel(ctx), ref)
	if err != nil {
		p.Log.Warn("leaguesync: stored snapshot", "league", ref.Key(), "err", err)
		return
	}
	e.loaded = true
	if ok {
		e.snap, e.stored = &snap, true
	}
}

// cached is the entry's last read with its staleness, or its last error.
func (p *Poller) cached(e *pollEntry, now time.Time, gap time.Duration) (Read, error) {
	if e.snap == nil {
		return Read{}, e.err
	}
	r := Read{Snapshot: *e.snap}
	age := now.Sub(e.snap.ReadAt)
	if e.err != nil || (e.stored && age >= gap) {
		r.Stale = age
	}
	return r, nil
}
