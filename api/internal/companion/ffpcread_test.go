package companion

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// fakeMember answers each account's own board and counts reads per account.
type fakeMember struct {
	mu     sync.Mutex
	boards map[uuid.UUID]ffpc.Draft
	reads  map[uuid.UUID]int
	failed map[uuid.UUID]error
}

func (f *fakeMember) ReadDraft(_ context.Context, accountID uuid.UUID, _ string) (ffpc.Draft, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads[accountID]++
	if err := f.failed[accountID]; err != nil {
		return ffpc.Draft{}, err
	}
	d, ok := f.boards[accountID]
	if !ok {
		return ffpc.Draft{}, hosts.ErrNotConnected
	}
	return d, nil
}

func (f *fakeMember) readCount(accountID uuid.UUID) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.reads[accountID]
}

func (f *fakeMember) ReadLeague(context.Context, uuid.UUID, string, bool) (ffpc.League, error) {
	return ffpc.League{}, nil
}

func (f *fakeMember) OpenLeague(context.Context, uuid.UUID, string) (string, error) { return "", nil }

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func newRig() (*FFPCDrafts, *fakeMember, *fakeClock, uuid.UUID, uuid.UUID) {
	a, b := uuid.New(), uuid.New()
	m := &fakeMember{
		boards: map[uuid.UUID]ffpc.Draft{
			a: {Teams: 12, Rounds: 20, MySlot: 3, Picks: []ffpc.Pick{{Number: 1, Round: 1, Slot: 1}}},
			b: {Teams: 10, Rounds: 20, MySlot: 7},
		},
		reads: map[uuid.UUID]int{}, failed: map[uuid.UUID]error{},
	}
	clock := &fakeClock{now: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)}
	return &FFPCDrafts{Member: m, Now: clock.Now}, m, clock, a, b
}

// Two members of one league each read as themselves: neither is served
// the board fetched with the other's sign-in.
func TestFFPCReadsAreKeyedByAccount(t *testing.T) {
	d, m, _, a, b := newRig()
	ra, err := d.Read(context.Background(), a, "104870", "lt")
	if err != nil {
		t.Fatal(err)
	}
	rb, err := d.Read(context.Background(), b, "104870", "lt")
	if err != nil {
		t.Fatal(err)
	}
	if m.readCount(a) != 1 || m.readCount(b) != 1 {
		t.Fatalf("reads a=%d b=%d, want one each", m.readCount(a), m.readCount(b))
	}
	if ra.Draft.Teams != 12 || rb.Draft.Teams != 10 {
		t.Fatalf("teams a=%d b=%d: a board crossed accounts", ra.Draft.Teams, rb.Draft.Teams)
	}
}

// A member with no FFPC connection gets the connect error, never a board
// another member of the league fetched.
func TestFFPCUnconnectedMemberNeverSeesAnotherRead(t *testing.T) {
	d, _, _, a, _ := newRig()
	if _, err := d.Read(context.Background(), a, "104870", "lt"); err != nil {
		t.Fatal(err)
	}
	_, err := d.Read(context.Background(), uuid.New(), "104870", "lt")
	if !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("err = %v, want not connected", err)
	}
}

// One upstream read per league per interval per account, whatever the
// number of viewers, and a stale answer says how stale.
func TestFFPCPollingPerAccount(t *testing.T) {
	d, m, clock, a, _ := newRig()
	ctx := context.Background()
	for range 5 {
		if _, err := d.Read(ctx, a, "104870", "lt"); err != nil {
			t.Fatal(err)
		}
	}
	if m.readCount(a) != 1 {
		t.Fatalf("%d reads within the interval", m.readCount(a))
	}
	clock.now = clock.now.Add(FFPCGap + time.Second)
	m.mu.Lock()
	m.failed[a] = ffpc.ErrUnavailable
	m.mu.Unlock()
	r, err := d.Read(ctx, a, "104870", "lt")
	if err != nil {
		t.Fatal(err)
	}
	if r.Stale < FFPCGap || m.readCount(a) != 2 {
		t.Fatalf("stale %v after %d reads", r.Stale, m.readCount(a))
	}
}
