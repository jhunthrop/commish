package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

// An account asks about at most five new leagues an hour, asking again
// about one is free, the hour frees them, and a host serves only so many
// new leagues at once whoever asks.
func TestAdmissionBoundsNewLeagues(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	a := &Admission{Now: clock.Now}
	me := uuid.New()
	ref := func(i int) Ref { return Ref{Host: HostSleeper, LeagueID: fmt.Sprint(1000 + i)} }
	for i := range NewLeaguesPerHour {
		release, err := a.Admit(me, ref(i))
		if err != nil {
			t.Fatalf("league %d: %v", i, err)
		}
		release()
	}
	if _, err := a.Admit(me, ref(NewLeaguesPerHour)); !errors.Is(err, ErrTooManyNew) {
		t.Fatalf("a sixth new league answered %v", err)
	}
	release, err := a.Admit(me, ref(0))
	if err != nil {
		t.Fatalf("asking again about the first: %v", err)
	}
	release()
	clock.Advance(time.Hour)
	release, err = a.Admit(me, ref(NewLeaguesPerHour))
	if err != nil {
		t.Fatalf("an hour later: %v", err)
	}
	release()

	var held []func()
	for i := range hostQueueCap()[HostMFL] {
		r, err := a.Admit(uuid.New(), Ref{Host: HostMFL, LeagueID: fmt.Sprint(20000 + i), Season: 2026})
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, r)
	}
	if _, err := a.Admit(uuid.New(), Ref{Host: HostMFL, LeagueID: "29999", Season: 2026}); !errors.Is(err, ErrBusy) {
		t.Fatalf("a third MyFantasyLeague read at once answered %v", err)
	}
	held[0]()
	held[0]()
	r, err := a.Admit(uuid.New(), Ref{Host: HostMFL, LeagueID: "29998", Season: 2026})
	if err != nil {
		t.Fatalf("after one finished: %v", err)
	}
	r()
}

// A viewer who gives up on a league never read cancels its read.
func TestLastWaiterCancelsTheRead(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	host := &blockingHost{started: make(chan struct{}), cancelled: make(chan struct{})}
	p := &Poller{Hosts: Hosts{host}, Store: &memorySnapshots{}, Now: clock.Now, Log: quietLog()}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := p.Read(ctx, testRef)
		done <- err
	}()
	<-host.started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("the viewer got %v", err)
	}
	select {
	case <-host.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("the read kept going after its only viewer left")
	}
}

type blockingHost struct {
	Sleeper
	started   chan struct{}
	cancelled chan struct{}
}

func (h *blockingHost) Read(ctx context.Context, _ Ref) (Snapshot, error) {
	close(h.started)
	<-ctx.Done()
	close(h.cancelled)
	return Snapshot{}, ctx.Err()
}
