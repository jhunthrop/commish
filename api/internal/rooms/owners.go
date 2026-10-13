package rooms

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/lobby"
)

// Lease timings, together under the shortest pick clock (10 seconds,
// app.rooms.clock_seconds' floor; lobbies run 30 and 45).
//
// A room's clock runs on the instance holding its lease, renewed every
// Renew to Lease from now. An instance that dies stops renewing, so its
// lease lapses at most Lease after its last renewal; every instance that
// is live (holding a room's clock or serving a room's sockets) runs a
// pass every Sweep that adopts lapsed rooms, its own sockets' rooms first,
// and an adopted room's clock acts at once on any event that fell due
// while nobody held it. The worst case from an instance dying to the next
// clock tick is therefore Lease + Sweep plus a query: 7 seconds, inside
// even a 10 second clock (measured in the lane report). A drafter whose
// socket died with the instance reconnects to a live instance, which
// serves the room and so adopts it within that bound.
//
// Out of season the cost is nothing: an instance holding no room and
// serving no socket makes no query at all (one claim at start aside) and
// holds no LISTEN connection (Hub listens only while subscribed), so the
// database can suspend. A lapsed room is then adopted when a drafter's
// socket arrives (Socket.Adopt, a single update on the room's lease), or
// by any instance that becomes live; a room nobody is connected to waits
// for its next drafter, who catches it up at once.
const (
	DefaultLease = 6 * time.Second
	DefaultRenew = 2 * time.Second
	DefaultSweep = time.Second
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
	Pool     *pgxpool.Pool
	Store    *lobby.Store
	Clock    *lobby.Clock
	Hub      *Hub
	Instance string
	Lease    time.Duration
	Renew    time.Duration
	Sweep    time.Duration
	// Serving is the rooms this instance has a drafter's socket open on;
	// each pass adopts any of them whose lease has lapsed.
	Serving func() []uuid.UUID
	Now     func() time.Time
	Log     *slog.Logger

	mu      sync.Mutex
	running map[uuid.UUID]context.CancelFunc
	base    context.Context
	wg      sync.WaitGroup
}

// Run keeps the leases until ctx ends, then gives them up so another
// instance adopts the rooms at once.
func (o *Owners) Run(ctx context.Context) {
	o.mu.Lock()
	o.running = map[uuid.UUID]context.CancelFunc{}
	o.base = ctx
	o.mu.Unlock()
	o.claim(ctx)
	lastRenew := o.Now()
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
		served := o.served()
		if o.holding() == 0 && len(served) == 0 {
			continue // idle: no query
		}
		if now := o.Now(); o.holding() > 0 && now.Sub(lastRenew) >= o.Renew {
			o.renew(ctx)
			lastRenew = now
		}
		o.adopt(ctx, served)
		o.claim(ctx)
	}
}

func (o *Owners) served() []uuid.UUID {
	if o.Serving == nil {
		return nil
	}
	return o.Serving()
}

// holding is how many rooms this instance keeps the clock of.
func (o *Owners) holding() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.running)
}

// Adopt claims one room for this instance if no live lease holds it: a
// drafter connecting starts a lapsed room's clock without waiting a pass.
func (o *Owners) Adopt(ctx context.Context, id uuid.UUID) {
	o.adopt(ctx, []uuid.UUID{id})
}

// adopt claims each of ids that is live and whose lease is missing or
// lapsed, and starts its clock.
func (o *Owners) adopt(ctx context.Context, ids []uuid.UUID) {
	if len(ids) == 0 {
		return
	}
	rows, err := o.Pool.Query(ctx, `update app.rooms set owner_instance = $1, lease_until = now() + $2::interval
		where id = any($3) and status in ('filling', 'drafting') and (lease_until is null or lease_until < now())
		returning id`, o.Instance, o.Lease.String(), ids)
	if err != nil {
		o.Log.Warn("rooms: adopt", "err", err)
		return
	}
	claimed, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		o.Log.Warn("rooms: adopt", "err", err)
		return
	}
	o.mu.Lock()
	base := o.base
	o.mu.Unlock()
	if base == nil {
		return
	}
	for _, id := range claimed {
		o.start(base, id)
	}
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
