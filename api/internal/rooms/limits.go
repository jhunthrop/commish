package rooms

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/time/rate"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Command budgets per seat, shared by every socket the seat holds on this
// instance, so a second tab or a reconnect loop never doubles a seat's
// budget. A queue edit is a drag in the pool, so it is generous; a pick or
// a leave is a click, a few a second at most. Each command type has its
// own bucket, so a burst of queue edits never blocks a pick. A command
// over its budget is dropped with an error frame; a socket that keeps
// sending past it is closed.
const (
	queuePerSecond = 5
	queueBurst     = 10
	pickPerSecond  = 2
	pickBurst      = 3
	leavePerSecond = 1
	leaveBurst     = 2
	otherPerSecond = 1
	otherBurst     = 2
	abusiveDropped = 30
)

// Socket budgets per seat: at most maxSocketsPerSeat open at once (three
// tabs is generous for one drafter), and a new socket at most
// connectPerMinute a minute after a burst of connectBurst (a flaky
// network reconnecting is well inside it). Over either, the newest socket
// is refused with a reason frame and closed. A seat with no socket for
// forgetAfter drops its buckets.
const (
	maxSocketsPerSeat = 3
	connectPerMinute  = 12
	connectBurst      = 6
	forgetAfter       = 10 * time.Minute
)

// Refusal reasons a socket is closed with.
const (
	reasonTooManySockets = "This seat already has three tabs open on the room. Close one and reload."
	reasonConnectingFast = "This seat is reconnecting too fast. Wait a few seconds and reload."
)

type seatKey struct {
	room uuid.UUID
	seat int
}

// seatBudget is one seat's buckets. The limiters are safe to share; open
// and idleSince are guarded by seatLimits.mu.
type seatBudget struct {
	queue, pick, leave, other, connect *rate.Limiter
	open                               int
	idleSince                          time.Time
}

func newSeatBudget() *seatBudget {
	return &seatBudget{
		queue:   rate.NewLimiter(queuePerSecond, queueBurst),
		pick:    rate.NewLimiter(pickPerSecond, pickBurst),
		leave:   rate.NewLimiter(leavePerSecond, leaveBurst),
		other:   rate.NewLimiter(otherPerSecond, otherBurst),
		connect: rate.NewLimiter(rate.Every(time.Minute/connectPerMinute), connectBurst),
	}
}

// allow spends one command of its type's budget.
func (b *seatBudget) allow(t apitypes.RoomCommandType) bool {
	switch t {
	case apitypes.RoomCommandTypeQueue:
		return b.queue.Allow()
	case apitypes.RoomCommandTypePick:
		return b.pick.Allow()
	case apitypes.RoomCommandTypeLeave:
		return b.leave.Allow()
	}
	return b.other.Allow()
}

// seatLimits is every seat's budget on this instance.
type seatLimits struct {
	mu    sync.Mutex
	seats map[seatKey]*seatBudget
}

// open admits a new socket for the seat, answering its budget, or the
// reason it is refused.
func (l *seatLimits) open(key seatKey, now time.Time) (*seatBudget, string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.forget(now)
	if l.seats == nil {
		l.seats = map[seatKey]*seatBudget{}
	}
	b, ok := l.seats[key]
	if !ok {
		b = newSeatBudget()
		l.seats[key] = b
	}
	if b.open >= maxSocketsPerSeat {
		return nil, reasonTooManySockets
	}
	if !b.connect.AllowN(now, 1) {
		return nil, reasonConnectingFast
	}
	b.open++
	return b, ""
}

// close is one of the seat's sockets ending.
func (l *seatLimits) close(key seatKey, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if b, ok := l.seats[key]; ok {
		b.open--
		if b.open == 0 {
			b.idleSince = now
		}
	}
}

// forget drops the buckets of seats with no socket for forgetAfter.
func (l *seatLimits) forget(now time.Time) {
	for k, b := range l.seats {
		if b.open == 0 && now.Sub(b.idleSince) >= forgetAfter {
			delete(l.seats, k)
		}
	}
}
