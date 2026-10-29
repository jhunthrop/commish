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

	"github.com/google/uuid"

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
	// LiveWait is how long a view waits for a fresh read while a game is
	// live (Lane 92 fix round 1): past it the view answers the kept read
	// with its own read time, and the read lands for the next view.
	LiveWait     = 3 * time.Second
	RefreshFloor = 10 * time.Second
	ReadTimeout  = 30 * time.Second
	// idleAfter drops a league no viewer has asked about in this long.
	idleAfter = ViewWindow
)

// ViewWindow is how long a league counts as viewed after its last view:
// the poller keeps reading it that long, and the trade search warms for
// the accounts that viewed it inside it (Lane 66u).
const ViewWindow = 30 * time.Minute

// SnapshotStore keeps the last good read per host league. PutSnapshot
// keeps nothing for a league no account has linked, and says whether it
// stored the read.
type SnapshotStore interface {
	LastSnapshot(ctx context.Context, ref Ref) (Snapshot, bool, error)
	PutSnapshot(ctx context.Context, snap Snapshot) (bool, error)
}

// Read is a snapshot and how stale it is (poll.Read's rule). Failed is a
// stale read whose last try failed, never a kept read waiting on the next;
// SignedOut is one that failed because the account it is read as is not
// signed in to the host, so their own sign-in mends it.
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
	// Landed, when set, is told of every good read the store wrote (the
	// trade search warms on it, Lane 66u); a failed read, or one the store
	// kept nothing of (a league no one has attached), tells it nothing, so
	// the work done for the read before stands. It runs on the storing
	// goroutine and must return at once.
	Landed func(Snapshot)
	// Live reports a game of the season under way (Lane 92, B06): then a
	// read older than MinUpstreamGap waits up to LiveWait for the fresh one
	// rather than answer the last read at once while one goes upstream
	// behind it, so a screen shows the fresh score unless the platform is
	// slow, and then the kept one with its read time. Nil is never live.
	Live func(ctx context.Context, season int) bool
	// After is the live wait's timer (poll.Poller.After), time.After when
	// nil: a test's fake clock gives its own.
	After func(time.Duration) <-chan time.Time
	// Schedule fills each read's season schedule from the kept weeks for a
	// host whose read carries none, reading the weeks it lacks behind the
	// read (Lane 298); nil leaves such a read without one.
	Schedule *ScheduleKeeper

	once  sync.Once
	inner *poll.Poller[Snapshot]
}

func (p *Poller) shared() *poll.Poller[Snapshot] {
	p.once.Do(func() {
		p.inner = &poll.Poller[Snapshot]{
			Now: p.Now, Store: snapshots{store: p.Store, landed: p.landed}, Log: p.Log, Idle: idleAfter, Timeout: ReadTimeout,
			Bound: LiveWait, After: p.After,
		}
	})
	return p.inner
}

// Upstream is how many whole reads reached a host.
func (p *Poller) Upstream() int64 { return p.shared().Upstream() }

// Holds reports whether this process has a read of the league, so a view
// of it costs the host nothing new.
func (p *Poller) Holds(ref Ref) bool { return p.shared().Holds(ref.Key()) }

// Read is the league as of at most MinUpstreamGap ago: past the minute
// the last read, with one going upstream behind it, except while a game
// is live, when the view waits up to LiveWait for that read (Live).
func (p *Poller) Read(ctx context.Context, ref Ref) (Read, error) {
	mode := poll.Revalidate
	if p.Live != nil && p.Live(ctx, ref.Season) {
		mode = poll.Bounded
	}
	return p.read(ctx, ref, MinUpstreamGap, mode)
}

// Refresh is the league read again now, waiting for the host, unless a
// read went upstream inside RefreshFloor, which it shares.
func (p *Poller) Refresh(ctx context.Context, ref Ref) (Read, error) {
	return p.read(ctx, ref, RefreshFloor, poll.Wait)
}

func (p *Poller) read(ctx context.Context, ref Ref, gap time.Duration, mode poll.Mode) (Read, error) {
	host, ok := p.Hosts.ByKey(ref.Host)
	if !ok && switchable(ref.Host) {
		return Read{}, ErrHostOff
	}
	if !ok {
		return Read{}, ErrNotALink
	}
	r, err := p.shared().Read(ctx, ref.Key(), gap, mode, func(ctx context.Context) (Snapshot, error) {
		snap, err := host.Read(ctx, ref)
		snap.Ref.As = ref.As
		if err == nil {
			snap = p.Schedule.Fill(ctx, host, snap)
		}
		return snap, err
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
	stored, err := p.Store.PutSnapshot(ctx, snap)
	if err != nil {
		p.Log.Warn("leaguesync: keep snapshot", "league", snap.Ref.Key(), "err", err)
		return
	}
	if stored {
		p.landed(snap)
	}
}

// landed tells Landed of a stored read, if anyone listens.
func (p *Poller) landed(snap Snapshot) {
	if p.Landed != nil {
		p.Landed(snap)
	}
}

// Prime gives the poller a read made outside it (an FFPC attach, read as
// the attaching member), so the first view answers it fresh.
func (p *Poller) Prime(snap Snapshot) { p.shared().Prime(snap.Ref.Key(), snap, snap.ReadAt) }

// snapshots is the store as poll keeps reads: by the league's key, each
// good read told to landed once kept.
type snapshots struct {
	store  SnapshotStore
	landed func(Snapshot)
}

func (s snapshots) Last(ctx context.Context, key string) (Snapshot, time.Time, bool, error) {
	ref, ok := refOfKey(key)
	if !ok {
		return Snapshot{}, time.Time{}, false, nil
	}
	snap, found, err := s.store.LastSnapshot(ctx, ref)
	return snap, snap.ReadAt, found, err
}

func (s snapshots) Keep(ctx context.Context, key string, snap Snapshot, at time.Time) error {
	snap.ReadAt = at
	if ref, ok := refOfKey(key); ok {
		snap.Ref.As = ref.As
	}
	stored, err := s.store.PutSnapshot(ctx, snap)
	if err != nil {
		return err
	}
	if stored {
		s.landed(snap)
	}
	return nil
}

// refOfKey reads Ref.Key back: "host/season/id", with "@account" for a
// read made as one account.
func refOfKey(key string) (Ref, bool) {
	key, as, member := strings.Cut(key, asSeparator)
	parts := strings.SplitN(key, "/", 3)
	if len(parts) != 3 {
		return Ref{}, false
	}
	season, err := strconv.Atoi(parts[1])
	if err != nil {
		return Ref{}, false
	}
	ref := Ref{Host: parts[0], Season: season, LeagueID: parts[2]}
	if member {
		id, err := uuid.Parse(as)
		if err != nil {
			return Ref{}, false
		}
		ref.As = id
	}
	return ref, true
}
