package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db"
)

// failoverPoll is how often the lease is read while waiting on the takeover.
const failoverPoll = 20 * time.Millisecond

// failoverSetup is the failover measurement's two room instances.
type failoverSetup struct {
	format  string
	a, b    string // room service origins, ws://host:port
	killPID int    // instance a's process
	lead    time.Duration
}

// failoverRun is what the observer socket has seen.
type failoverRun struct {
	mu       sync.Mutex
	seq      int64
	deadline time.Time
	next     chan time.Time // the first row after the kill, on instance b
	killSeq  int64
}

// measureFailover seats a full room on instance a, waits until the pick
// on the clock is lead from running out, kills a with SIGKILL (no lease
// release, as a crash), moves every drafter's socket to instance b as a
// load balancer would, and times b taking the lease and the room's next
// clock tick. The pick that fell due while nobody held the room shows
// how late a crash makes it.
func measureFailover(ctx context.Context, env environment, setup failoverSetup) error {
	if setup.killPID <= 0 {
		return errors.New("-kill is the pid of the room instance at -a")
	}
	drafters, seats, err := joinLobby(ctx, env, "failover", setup.format, 12)
	if err != nil {
		return err
	}
	room := seats[0].RoomId
	pool, err := db.Open(env.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	run := &failoverRun{next: make(chan time.Time, 1)}
	sockets := make([]*socket, len(drafters))
	for i, d := range drafters {
		s, welcome, _, err := dial(ctx, d, onOrigin(setup.a, seats[i].SocketUrl), 0)
		if err != nil {
			return err
		}
		sockets[i] = s
		if i == 0 {
			run.observe(welcome)
			go run.watch(s)
		} else {
			go drain(s)
		}
	}
	at, err := run.waitForClock(ctx, setup.lead)
	if err != nil {
		return err
	}
	time.Sleep(time.Until(at))
	owner, leaseLeft, err := lease(ctx, pool, room)
	if err != nil {
		return err
	}
	run.mu.Lock()
	run.killSeq = run.seq
	deadline := run.deadline
	run.mu.Unlock()
	killed := time.Now()
	if err := syscall.Kill(setup.killPID, syscall.SIGKILL); err != nil {
		return fmt.Errorf("kill %d: %w", setup.killPID, err)
	}
	for _, s := range sockets {
		s.close()
	}
	for i, d := range drafters {
		s, welcome, _, err := dial(ctx, d, onOrigin(setup.b, seats[i].SocketUrl), run.killSeq)
		if err != nil {
			return err
		}
		if i == 0 {
			run.observe(welcome)
			go run.watch(s)
		} else {
			go drain(s)
		}
	}
	adopted, err := waitForOwner(ctx, pool, room, owner)
	if err != nil {
		return err
	}
	var next time.Time
	select {
	case next = <-run.next:
	case <-time.After(time.Minute):
		return errors.New("no clock tick within a minute of the kill")
	}
	fmt.Printf("room %s, killed %s with %.1f s of its lease left, the pick on the clock due %.1f s after the kill\n",
		room, owner, leaseLeft.Seconds(), deadline.Sub(killed).Seconds())
	fmt.Printf("%-44s %.2f s\n", "kill to the lease taken over", adopted.Sub(killed).Seconds())
	fmt.Printf("%-44s %.2f s\n", "kill to the next clock tick", next.Sub(killed).Seconds())
	fmt.Printf("%-44s %.2f s\n", "the due pick, late by", next.Sub(deadline).Seconds())
	return nil
}

// observe takes a welcome or update's last seq and the latest deadline.
func (run *failoverRun) observe(f frame) {
	run.mu.Lock()
	defer run.mu.Unlock()
	for _, a := range f.Actions {
		run.seq = max(run.seq, a.Seq)
		if d, ok := a.Payload["deadline"].(string); ok {
			if t, err := time.Parse(time.RFC3339Nano, d); err == nil {
				run.deadline = t
			}
		}
		// The next tick is the next pick: a seat coming back writes rows
		// too, and those are not the clock's.
		if _, pick := a.Payload["pick"]; pick && run.killSeq > 0 && a.Seq > run.killSeq {
			select {
			case run.next <- f.At:
			default:
			}
		}
	}
}

func (run *failoverRun) watch(s *socket) {
	for f := range s.frames {
		run.observe(f)
	}
}

// waitForClock waits for a pick clock with more than lead left and
// answers when to kill: lead before it runs out.
func (run *failoverRun) waitForClock(ctx context.Context, lead time.Duration) (time.Time, error) {
	for range 600 {
		run.mu.Lock()
		deadline := run.deadline
		run.mu.Unlock()
		if time.Until(deadline) > lead+time.Second {
			return deadline.Add(-lead), nil
		}
		select {
		case <-ctx.Done():
			return time.Time{}, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return time.Time{}, errors.New("the room never put a pick on the clock")
}

func drain(s *socket) {
	for range s.frames {
	}
}

func lease(ctx context.Context, pool *pgxpool.Pool, room uuid.UUID) (string, time.Duration, error) {
	var owner string
	var until time.Time
	err := pool.QueryRow(ctx, `select owner_instance, lease_until from app.rooms where id = $1`, room).Scan(&owner, &until)
	return owner, time.Until(until), err
}

func waitForOwner(ctx context.Context, pool *pgxpool.Pool, room uuid.UUID, dead string) (time.Time, error) {
	for range int(time.Minute / failoverPoll) {
		var owner *string
		if err := pool.QueryRow(ctx, `select owner_instance from app.rooms where id = $1`, room).Scan(&owner); err != nil {
			return time.Time{}, err
		}
		if owner != nil && *owner != dead {
			return time.Now(), nil
		}
		time.Sleep(failoverPoll)
	}
	return time.Time{}, errors.New("no instance took the lease within a minute")
}

// onOrigin is the socket URL's path on another room instance.
func onOrigin(origin, socketURL string) string {
	u, err := url.Parse(socketURL)
	if err != nil {
		return socketURL
	}
	return origin + u.RequestURI()
}
