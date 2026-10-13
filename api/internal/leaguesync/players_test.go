package leaguesync

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// dirHost answers its directory, or fails, and counts the reads.
type dirHost struct {
	Sleeper
	reads atomic.Int64
	down  atomic.Bool
}

func (h *dirHost) Players(context.Context, int) ([]HostPlayer, error) {
	h.reads.Add(1)
	if h.down.Load() {
		return nil, ErrUnavailable
	}
	return []HostPlayer{{ID: "96", Name: "Aaron Rodgers", Position: "QB", Team: "PIT", ESPNID: "8439"}}, nil
}

type emptyPlayerStore struct{}

func (emptyPlayerStore) HostPlayers(context.Context, string) ([]HostPlayer, time.Time, error) {
	return nil, time.Time{}, nil
}

func (emptyPlayerStore) PutHostPlayers(context.Context, string, []HostPlayer, time.Time) error {
	return nil
}

// A host whose directory has never been read answers ErrNoDirectory, not
// an empty directory, and is tried again a minute later, not an hour.
func TestDirectoryNeverReadIsUnavailableAndRetried(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	host := &dirHost{}
	host.down.Store(true)
	d := &Directory{Hosts: Hosts{host}, Store: emptyPlayerStore{}, Now: clock.Now, Log: quietLog()}
	ctx := context.Background()
	if _, err := d.For(ctx, HostSleeper, 2026, nil); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("a failed first read answered %v", err)
	}
	clock.Advance(30 * time.Second)
	if _, err := d.For(ctx, HostSleeper, 2026, nil); !errors.Is(err, ErrNoDirectory) || host.reads.Load() != 1 {
		t.Fatalf("inside the minute: %v after %d reads", err, host.reads.Load())
	}
	host.down.Store(false)
	clock.Advance(31 * time.Second)
	got, err := d.For(ctx, HostSleeper, 2026, nil)
	if err != nil || got["96"].Name != "Aaron Rodgers" || host.reads.Load() != 2 {
		t.Fatalf("a minute later: %v, %d reads", err, host.reads.Load())
	}
}
