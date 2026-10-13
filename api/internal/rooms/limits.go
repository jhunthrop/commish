package rooms

import (
	"golang.org/x/time/rate"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Command budgets per socket. A queue edit is a drag in the pool, so it
// is generous; a pick or a leave is a click, a few a second at most. Each
// command type has its own bucket, so a burst of queue edits never blocks
// a pick. A command over its budget is dropped with an error frame; a
// socket that keeps sending past it is closed.
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

type commandLimits struct {
	queue, pick, leave, other *rate.Limiter
	dropped                   int
}

func newCommandLimits() *commandLimits {
	return &commandLimits{
		queue: rate.NewLimiter(queuePerSecond, queueBurst),
		pick:  rate.NewLimiter(pickPerSecond, pickBurst),
		leave: rate.NewLimiter(leavePerSecond, leaveBurst),
		other: rate.NewLimiter(otherPerSecond, otherBurst),
	}
}

// allow spends one command of its type's budget.
func (c *commandLimits) allow(t apitypes.RoomCommandType) bool {
	l := c.other
	switch t {
	case apitypes.RoomCommandTypeQueue:
		l = c.queue
	case apitypes.RoomCommandTypePick:
		l = c.pick
	case apitypes.RoomCommandTypeLeave:
		l = c.leave
	}
	if l.Allow() {
		return true
	}
	c.dropped++
	return false
}

// abusive reports whether the socket has kept sending past its budget.
func (c *commandLimits) abusive() bool { return c.dropped >= abusiveDropped }
