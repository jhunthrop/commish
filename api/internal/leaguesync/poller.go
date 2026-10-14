package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/poll"
)

// Polling discipline (spec §2.9, internal/poll, the companion's at a
// league's pace): one upstream read per league per minute whatever the
// number of viewers, since rosters change slowly; past the minute a view
// answers the last read while one read goes upstream behind it; a
// deliberate refresh waits for a read, but never sends two inside
// RefreshFloor; the last good read of a linked league survives a restart
// through the store. A read is cancelled when every viewer waiting on it
// has gone, leaving no trace (no failure, no gap held), and one nobody
// waits on runs at most ReadTimeout.
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

// Read is a snapshot and how stale it is (poll.Read's rule). Failed is a
// stale read whose last try failed, never a kept read waiting on the next;
// SignedOut is one that failed because no member of the league is signed
// in to the host, so a sign-in mends it.
type Read struct {
	Snapshot
	Stale     time.Duration
	Failed    bool
	SignedOut bool
}

// Poller shares one upstream read per league between every viewer.
type Poller struct {
	Hosts Hosts
	Store SnapshotStore
	Now   func() time.Time
	Log   *slog.Logger

	once  sync.Once
	inner *poll.Poller[Snapshot]
}

func (p *Poller) shared() *poll.Poller[Snapshot] {
	p.once.Do(func() {
		p.inner = &poll.Poller[Snapshot]{
			Now: p.Now, Store: snapshots{p.Store}, Log: p.Log, Idle: idleAfter, Timeout: ReadTimeout,
		}
	})
	return p.inner
}

// Upstream is how many whole reads reached a host.
func (p *Poller) Upstream() int64 { return p.shared().Upstream() }

// Holds reports whether this process has a read of the league, so a view
// of it costs the host nothing new.
func (p *Poller) Holds(ref Ref) bool { return p.shared().Holds(ref.Key()) }

// Read is the league as of at most MinUpstreamGap ago.
func (p *Poller) Read(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, MinUpstreamGap, poll.Revalidate)
}

// Refresh is the league read again now, waiting for the host, unless a
// read went upstream inside RefreshFloor, which it shares.
func (p *Poller) Refresh(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, RefreshFloor, poll.Wait)
}

func (p *Poller) read(ctx context.Context, ref Ref, gap time.Duration, mode poll.Mode) (Read, error) {
	host, ok := p.Hosts.ByKey(ref.Host)
	if !ok && readAsMember(ref.Host) {
		return Read{}, ErrHostOff
	}
	if !ok {
		return Read{}, ErrNotALink
	}
	r, err := p.shared().Read(ctx, ref.Key(), gap, mode, func(ctx context.Context) (Snapshot, error) {
		return host.Read(ctx, ref)
	})
	if errors.Is(err, poll.ErrNoRead) {
		return Read{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if err != nil {
		return Read{}, err
	}
	snap := r.Value
	snap.ReadAt = r.At
	failed := r.Stale > 0 && r.Err != nil
	return Read{Snapshot: snap, Stale: r.Stale, Failed: failed, SignedOut: failed && signedOut(r.Err)}, nil
}

// signedOut reports whether a read failed for want of a signed-in member.
func signedOut(err error) bool {
	return errors.Is(err, ErrNotConnected) || errors.Is(err, ErrSignInAgain)
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

// Prime gives the poller a read made outside it (an FFPC attach, read as
// the attaching member), so the first view answers it fresh.
func (p *Poller) Prime(snap Snapshot) { p.shared().Prime(snap.Ref.Key(), snap, snap.ReadAt) }

// snapshots is the store as poll keeps reads: by the league's key.
type snapshots struct{ store SnapshotStore }

func (s snapshots) Last(ctx context.Context, key string) (Snapshot, time.Time, bool, error) {
	ref, ok := refOfKey(key)
	if !ok {
		return Snapshot{}, time.Time{}, false, nil
	}
	snap, found, err := s.store.LastSnapshot(ctx, ref)
	return snap, snap.ReadAt, found, err
}

func (s snapshots) Keep(ctx context.Context, _ string, snap Snapshot, at time.Time) error {
	snap.ReadAt = at
	return s.store.PutSnapshot(ctx, snap)
}

// refOfKey reads Ref.Key back: "host/season/id".
func refOfKey(key string) (Ref, bool) {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) != 3 {
		return Ref{}, false
	}
	season, err := strconv.Atoi(parts[1])
	if err != nil {
		return Ref{}, false
	}
	return Ref{Host: parts[0], Season: season, LeagueID: parts[2]}, true
}
