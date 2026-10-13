package rooms

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/lobby"
)

// Lease timings, and the database cadence they cost.
//
// While this instance holds a live room it renews its leases every Renew
// (well inside Lease, so a room is adopted within Lease of its instance
// dying) and sweeps for rooms to adopt every Sweep. While it holds none it
// sweeps every IdleSweep and never renews: a room's first drafter
// connecting adopts it at once (Socket.Adopt), so the slow sweep only
// catches a room whose instance died with nobody reconnecting. Out of
// season an idle instance touches the database once every IdleSweep and
// holds no LISTEN connection (Hub listens only while it has subscribers),
// so Neon can suspend.
const (
	DefaultLease     = 10 * time.Second
	DefaultRenew     = 3 * time.Second
	DefaultSweep     = time.Second
	DefaultIdleSweep = time.Minute
	// pollEvery bounds a live room's sleep: its clock re-reads the room at
	// least this often, so a half-open LISTEN connection cannot stall it.
	pollEvery = 2 * time.Second
	// retryAfter is the pause after a clock event that failed.
	retryAfter = time.Second
	// claimBatch is the most rooms one sweep adopts.
	claimBatch = 50
)

// Owners keeps the clock of every room this instance holds a lease on:
// one goroutine per live room, sleeping until the room's next due event
// (the fill deadline, a bot's think time, a pick clock) or until the
// room's log moves.
type Owners struct {
	Pool      *pgxpool.Pool
	Store     *lobby.Store
	Clock     *lobby.Clock
	Hub       *Hub
	Instance  string
	Lease     time.Duration
	Renew     time.Duration
	Sweep     time.Duration
	IdleSweep time.Duration
	Now       func() time.Time
	Log       *slog.Logger

	mu      sync.Mutex
	running map[uuid.UUID]context.CancelFunc
	base    context.Context
	wg      sync.WaitGroup
}

// Run sweeps and renews until ctx ends, then gives its leases up so
// another instance adopts the rooms at once.
func (o *Owners) Run(ctx context.Context) {
	o.mu.Lock()
	o.running = map[uuid.UUID]context.CancelFunc{}
	o.base = ctx
	o.mu.Unlock()
	o.claim(ctx)
	lastSweep, lastRenew := o.Now(), o.Now()
	tick := time.NewTicker(o.Sweep)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			o.wg.Wait()
			o.release()
			return
		case <-tick.C:
		}
		now := o.Now()
		live := o.holding() > 0
		if live && now.Sub(lastRenew) >= o.Renew {
			o.renew(ctx)
			lastRenew = now
		}
		sweepEvery := o.IdleSweep
		if live {
			sweepEvery = o.Sweep
		}
		if now.Sub(lastSweep) >= sweepEvery {
			o.claim(ctx)
			lastSweep = now
		}
	}
}

// holding is how many rooms this instance keeps the clock of.
func (o *Owners) holding() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.running)
}

// Adopt claims one room for this instance if no live lease holds it: the
// room's first drafter connecting starts its clock without waiting on the
// sweep.
func (o *Owners) Adopt(ctx context.Context, id uuid.UUID) {
	var claimed bool
	err := o.Pool.QueryRow(ctx, `update app.rooms set owner_instance = $1, lease_until = now() + $2::interval
		where id = $3 and status in ('filling', 'drafting') and (lease_until is null or lease_until < now())
		returning true`, o.Instance, o.Lease.String(), id).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		o.Log.Warn("rooms: adopt", "room", id, "err", err)
		return
	}
	o.mu.Lock()
	base := o.base
	o.mu.Unlock()
	if base == nil {
		return
	}
	o.start(base, id)
}

// claim adopts live rooms with no lease or a lapsed one: new rooms, and
// rooms whose instance died.
func (o *Owners) claim(ctx context.Context) {
	rows, err := o.Pool.Query(ctx, `update app.rooms set owner_instance = $1, lease_until = now() + $2::interval
		where id in (select id from app.rooms where status in ('filling', 'drafting') and (lease_until is null or lease_until < now())
			order by created_at limit $3 for update skip locked)
		returning id`, o.Instance, o.Lease.String(), claimBatch)
	if err != nil {
		o.Log.Warn("rooms: claim", "err", err)
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		o.Log.Warn("rooms: claim", "err", err)
		return
	}
	for _, id := range ids {
		o.start(ctx, id)
	}
}

// renew extends this instance's leases and stops the clock of any room
// it no longer holds (finished, or adopted while this instance stalled).
func (o *Owners) renew(ctx context.Context) {
	rows, err := o.Pool.Query(ctx, `update app.rooms set lease_until = now() + $2::interval
		where owner_instance = $1 and status in ('filling', 'drafting') returning id`, o.Instance, o.Lease.String())
	if err != nil {
		o.Log.Warn("rooms: renew", "err", err)
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		o.Log.Warn("rooms: renew", "err", err)
		return
	}
	held := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		held[id] = true
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	for id, cancel := range o.running {
		if !held[id] {
			cancel()
			delete(o.running, id)
		}
	}
}

func (o *Owners) release() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := o.Pool.Exec(ctx, `update app.rooms set owner_instance = null, lease_until = null where owner_instance = $1`, o.Instance); err != nil {
		o.Log.Warn("rooms: release", "err", err)
	}
}

func (o *Owners) start(ctx context.Context, id uuid.UUID) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, ok := o.running[id]; ok {
		return
	}
	rctx, cancel := context.WithCancel(ctx)
	o.running[id] = cancel
	o.wg.Add(1)
	go func() {
		defer o.wg.Done()
		o.keep(rctx, id)
		o.mu.Lock()
		delete(o.running, id)
		o.mu.Unlock()
		cancel()
	}()
}

// keep is one room's clock.
func (o *Owners) keep(ctx context.Context, id uuid.UUID) {
	moved, unsubscribe := o.Hub.Subscribe(id)
	defer unsubscribe()
	for ctx.Err() == nil {
		room, err := o.Store.Load(ctx, id)
		if err != nil {
			o.Log.Warn("rooms: clock read", "room", id, "err", err)
			if !o.wait(ctx, moved, retryAfter) {
				return
			}
			continue
		}
		if room.Status != lobby.StatusFilling && room.Status != lobby.StatusDrafting {
			o.Store.Forget(id)
			return
		}
		// A drafter past the presence window goes to the stand-in first.
		if room.AnyAbsent(o.Now()) {
			if _, err := o.Store.MarkAbsent(ctx, id); err != nil && ctx.Err() == nil {
				o.Log.Warn("rooms: presence", "room", id, "err", err)
			}
			continue
		}
		due := lobby.NextDue(room)
		// A live room re-reads itself at least every pollEvery, whatever the
		// hub says: a half-open LISTEN connection cannot stall its clock,
		// and a drafter's presence lapsing is seen within a poll.
		sleep := pollEvery
		if due.Kind != lobby.DueNothing {
			sleep = min(sleep, due.At.Sub(o.Now()))
		}
		if !o.wait(ctx, moved, sleep) {
			return
		}
		if due.Kind == lobby.DueNothing {
			continue
		}
		if o.Now().Before(due.At) {
			continue // the log moved first; read the room again
		}
		if err := o.Clock.Act(ctx, id, due); err != nil && ctx.Err() == nil {
			o.Log.Warn("rooms: clock", "room", id, "pick", due.Pick, "err", err)
			if !o.wait(ctx, moved, retryAfter) {
				return
			}
		}
	}
}

// wait sleeps for d, or until the room's log moves; false when the clock
// should stop. A due time already past does not wait at all.
func (o *Owners) wait(ctx context.Context, moved <-chan struct{}, d time.Duration) bool {
	if d <= 0 {
		return true
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-moved:
		return true
	case <-t.C:
		return true
	}
}
