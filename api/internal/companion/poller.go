package companion

import (
	"context"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Polling discipline (Lane 8): one upstream read per draft per two
// seconds whatever the number of viewers, the last snapshot answered
// with its age when the host fails.
const (
	MinUpstreamGap = 2 * time.Second
	// idleAfter drops a draft no viewer has asked about in this long.
	idleAfter = 10 * time.Minute
)

// Host is the host's draft as the companion reads it. *sleeper.Client
// implements it, and the replay fixture does in development.
type Host interface {
	Draft(ctx context.Context, id string) (sleeper.Draft, error)
	Picks(ctx context.Context, id string, teams, rounds int) ([]sleeper.Pick, error)
}

// Snapshot is the host's draft at one read.
type Snapshot struct {
	Draft     sleeper.Draft
	Picks     []sleeper.Pick
	FetchedAt time.Time
}

// Read is a snapshot and how stale it is: zero when this read reached
// the host or a read within the gap did, the age of the last good read
// when the host failed since.
type Read struct {
	Snapshot
	Stale time.Duration
}

type entry struct {
	mu       sync.Mutex
	snap     *Snapshot
	tried    time.Time
	lastSeen time.Time
}

// Poller shares one upstream read per draft between every viewer.
type Poller struct {
	Host Host
	Now  func() time.Time

	mu      sync.Mutex
	entries map[string]*entry
	// Upstream counts the reads that reached the host, for the measured
	// poll cost.
	upstream int64
}

// Upstream is how many reads reached the host.
func (p *Poller) Upstream() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.upstream
}

func (p *Poller) entryFor(id string, now time.Time) *entry {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.entries == nil {
		p.entries = map[string]*entry{}
	}
	for key, e := range p.entries {
		if now.Sub(e.lastSeen) > idleAfter && key != id {
			delete(p.entries, key)
		}
	}
	e, ok := p.entries[id]
	if !ok {
		e = &entry{}
		p.entries[id] = e
	}
	e.lastSeen = now
	return e
}

// Read is the draft as of at most MinUpstreamGap ago. A viewer that
// arrives while another's read is in flight waits for it and shares it.
func (p *Poller) Read(ctx context.Context, id string) (Read, error) {
	now := p.Now()
	e := p.entryFor(id, now)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.snap != nil && now.Sub(e.tried) < MinUpstreamGap {
		return p.answer(e, now), nil
	}
	e.tried = now
	p.mu.Lock()
	p.upstream++
	p.mu.Unlock()
	snap, err := p.fetch(ctx, id, now)
	if err != nil {
		if e.snap == nil {
			return Read{}, err
		}
		return p.answer(e, now), nil
	}
	e.snap = &snap
	return Read{Snapshot: snap}, nil
}

func (p *Poller) answer(e *entry, now time.Time) Read {
	r := Read{Snapshot: *e.snap}
	if e.tried.After(e.snap.FetchedAt) {
		r.Stale = now.Sub(e.snap.FetchedAt)
	}
	return r
}

func (p *Poller) fetch(ctx context.Context, id string, now time.Time) (Snapshot, error) {
	d, err := p.Host.Draft(ctx, id)
	if err != nil {
		return Snapshot{}, err
	}
	picks, err := p.Host.Picks(ctx, id, d.Teams, d.Rounds)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Draft: d, Picks: picks, FetchedAt: now}, nil
}
