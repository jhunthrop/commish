package companion

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/poll"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Polling discipline (Lane 8, internal/poll): one upstream read per draft
// per two seconds whatever the number of viewers, every viewer past the
// gap waiting for the read, the last snapshot answered with its age when
// the host fails. A disconnecting viewer never cancels the shared read:
// it runs to its timeout for the draft's other viewers (poll's Outlive).
// The shared read is per process: with N instances serving one draft the
// bound is N reads per two seconds.
const (
	MinUpstreamGap = 2 * time.Second
	// idleAfter drops a draft no viewer has asked about in this long.
	idleAfter = 10 * time.Minute
	// readTimeout bounds a read: two host requests of three seconds each.
	readTimeout = 10 * time.Second
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
	// MySlot and SlotNames are what a host's board says of the member's
	// seat and each slot's team (FFPC), empty where the host's draft
	// says them another way.
	MySlot    int
	SlotNames []string
}

// Read is a snapshot and how stale it is: zero when this read reached
// the host or a read within the gap did, the age of the last good read
// when the host failed since.
type Read struct {
	Snapshot
	Stale time.Duration
}

// Poller shares one upstream read per draft between every viewer.
type Poller struct {
	Host Host
	Now  func() time.Time

	once  sync.Once
	inner *poll.Poller[Snapshot]
}

func (p *Poller) shared() *poll.Poller[Snapshot] {
	p.once.Do(func() {
		p.inner = &poll.Poller[Snapshot]{
			Now: p.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Idle: idleAfter, Timeout: readTimeout,
			Outlive: true,
		}
	})
	return p.inner
}

// Upstream is how many reads reached the host.
func (p *Poller) Upstream() int64 { return p.shared().Upstream() }

// Read is the draft as of at most MinUpstreamGap ago. A viewer that
// arrives while another's read is in flight waits for it and shares it.
// Inside the gap no viewer reaches the host, whether the last read
// succeeded or not: each gets the last snapshot with its age, or, for a
// draft never read, the last read's error.
func (p *Poller) Read(ctx context.Context, id string) (Read, error) {
	r, err := p.shared().Read(ctx, id, MinUpstreamGap, poll.Wait, func(ctx context.Context) (Snapshot, error) {
		return p.fetch(ctx, id)
	})
	if err != nil {
		return Read{}, err
	}
	snap := r.Value
	snap.FetchedAt = r.At
	return Read{Snapshot: snap, Stale: r.Stale}, nil
}

func (p *Poller) fetch(ctx context.Context, id string) (Snapshot, error) {
	d, err := p.Host.Draft(ctx, id)
	if err != nil {
		return Snapshot{}, err
	}
	picks, err := p.Host.Picks(ctx, id, d.Teams, d.Rounds)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Draft: d, Picks: picks}, nil
}
