package rooms

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

func TestSeatLimitsCapSocketsPerSeat(t *testing.T) {
	var l seatLimits
	key := seatKey{room: uuid.New(), seat: 3}
	now := time.Now()
	for i := range maxSocketsPerSeat {
		if b, reason := l.open(key, now); b == nil {
			t.Fatalf("socket %d refused: %s", i+1, reason)
		}
	}
	if b, reason := l.open(key, now); b != nil || reason != reasonTooManySockets {
		t.Fatalf("socket past the cap: budget %v, reason %q", b, reason)
	}
	// Another seat in the same room has its own cap.
	if b, _ := l.open(seatKey{room: key.room, seat: 4}, now); b == nil {
		t.Fatal("another seat was refused")
	}
	l.close(key, now)
	if b, reason := l.open(key, now); b == nil {
		t.Fatalf("a socket after one closed was refused: %s", reason)
	}
}

func TestSeatLimitsConnectRate(t *testing.T) {
	var l seatLimits
	key := seatKey{room: uuid.New(), seat: 1}
	now := time.Now()
	for i := range connectBurst {
		if b, reason := l.open(key, now); b == nil {
			t.Fatalf("connect %d refused: %s", i+1, reason)
		}
		l.close(key, now)
	}
	if b, reason := l.open(key, now); b != nil || reason != reasonConnectingFast {
		t.Fatalf("connect past the burst: budget %v, reason %q", b, reason)
	}
	later := now.Add(time.Minute / connectPerMinute)
	if b, reason := l.open(key, later); b == nil {
		t.Fatalf("connect after the refill was refused: %s", reason)
	}
}

func TestSeatBudgetIsSharedAcrossSockets(t *testing.T) {
	var l seatLimits
	key := seatKey{room: uuid.New(), seat: 2}
	now := time.Now()
	first, _ := l.open(key, now)
	second, _ := l.open(key, now)
	if first != second {
		t.Fatal("two sockets of one seat got separate budgets")
	}
	for range pickBurst {
		if !first.allow(apitypes.RoomCommandTypePick) {
			t.Fatal("a pick inside the burst was refused")
		}
	}
	if second.allow(apitypes.RoomCommandTypePick) {
		t.Fatal("a second socket got a fresh pick budget")
	}
	if !second.allow(apitypes.RoomCommandTypeQueue) {
		t.Fatal("queue edits share the pick bucket")
	}
}

func TestSeatLimitsForgetIdleSeats(t *testing.T) {
	var l seatLimits
	key := seatKey{room: uuid.New(), seat: 1}
	now := time.Now()
	l.open(key, now)
	l.close(key, now)
	l.open(seatKey{room: uuid.New(), seat: 1}, now.Add(forgetAfter))
	if _, kept := l.seats[key]; kept {
		t.Fatal("an idle seat's budget was kept past forgetAfter")
	}
}

func TestPresenceRooms(t *testing.T) {
	var p presence
	a, b, room := uuid.New(), uuid.New(), uuid.New()
	p.enter(room, a)
	p.enter(room, b)
	if got := p.rooms(); len(got) != 1 || got[0] != room {
		t.Fatalf("rooms = %v, want [%s]", got, room)
	}
	p.leave(room, a)
	p.leave(room, b)
	if got := p.rooms(); len(got) != 0 {
		t.Fatalf("rooms after every socket left = %v", got)
	}
}
