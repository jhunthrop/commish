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
// answered with its age when the host fails, and it survives a restart
// through the store. The bound is per process: N instances serving one
// league make at most N reads a minute.
const (
	MinUpstreamGap = time.Minute
	RefreshFloor   = 10 * time.Second
	// idleAfter drops a league no viewer has asked about in this long.
	idleAfter = 30 * time.Minute
)

// SnapshotStore keeps the last good read per host league.
type SnapshotStore interface {
	LastSnapshot(ctx context.Context, ref Ref) (Snapshot, bool, error)
	PutSnapshot(ctx context.Context, snap Snapshot) error
}

// Read is a snapshot and how stale it is: zero when this read reached
// the host or a read within the gap did, the age of the last good read
// when the host failed since.
type Read struct {
	Snapshot
	Stale time.Duration
}

type pollEntry struct {
	mu       sync.Mutex
	snap     *Snapshot
	err      error
	tried    time.Time
	loaded   bool
	lastSeen time.Time
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

// Read is the league as of at most MinUpstreamGap ago.
func (p *Poller) Read(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, MinUpstreamGap)
}

// Refresh is the league read again now, unless a read went upstream
// inside RefreshFloor, which it shares.
func (p *Poller) Refresh(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, RefreshFloor)
}

func (p *Poller) read(ctx context.Context, ref Ref, gap time.Duration) (Read, error) {
	host, ok := p.Hosts.ByKey(ref.Host)
	if !ok {
		return Read{}, ErrNotALink
	}
	now := p.Now()
	e := p.entryFor(ref.Key(), now)
	e.mu.Lock()
	defer e.mu.Unlock()
	p.warm(ctx, e, ref)
	if !e.tried.IsZero() && now.Sub(e.tried) < gap {
		return p.cached(e, now)
	}
	if e.snap != nil && e.tried.IsZero() && now.Sub(e.snap.ReadAt) < gap {
		// A stored read from before a restart that is still fresh.
		return Read{Snapshot: *e.snap}, nil
	}
	e.tried = now
	p.mu.Lock()
	p.upstream++
	p.mu.Unlock()
	// The read is shared, so it outlives the viewer who started it; each
	// host request has its own timeout.
	snap, err := host.Read(context.WithoutCancel(ctx), ref)
	if err != nil {
		e.err = err
		return p.cached(e, now)
	}
	snap.ReadAt = now
	e.snap, e.err = &snap, nil
	if err := p.Store.PutSnapshot(context.WithoutCancel(ctx), snap); err != nil {
		p.Log.Warn("leaguesync: keep snapshot", "league", ref.Key(), "err", err)
	}
	return Read{Snapshot: snap}, nil
}

// warm loads the stored read the first time a league is asked about in
// this process.
func (p *Poller) warm(ctx context.Context, e *pollEntry, ref Ref) {
	if e.loaded {
		return
	}
	e.loaded = true
	snap, ok, err := p.Store.LastSnapshot(ctx, ref)
	if err != nil {
		p.Log.Warn("leaguesync: stored snapshot", "league", ref.Key(), "err", err)
		return
	}
	if ok {
		e.snap = &snap
	}
}

func (p *Poller) cached(e *pollEntry, now time.Time) (Read, error) {
	if e.snap == nil {
		return Read{}, e.err
	}
	r := Read{Snapshot: *e.snap}
	if e.err != nil || e.tried.After(e.snap.ReadAt) {
		r.Stale = now.Sub(e.snap.ReadAt)
	}
	return r, nil
}
