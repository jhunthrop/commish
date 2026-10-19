package leaguesync

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
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

// A platform that sends him without his accent, and no ESPN id, is placed
// by name on a board that keeps it (Lane 78), with and without a position.
func TestPlaceByNameReadsHisNameWithOrWithoutTheAccent(t *testing.T) {
	raw := &boards.Raw{Players: []boards.Player{{ID: "4569682", Name: "Audric Estimé", Position: draft.RB, Team: "DEN"}}}
	dir := map[string]HostPlayer{
		"h1": {ID: "h1", Name: "Audric Estime", Position: "RB", Team: "DEN"},
		"h2": {ID: "h2", Name: "Audric Estime"},
	}
	got := Place(raw, dir, []string{"h1", "h2"})
	for _, id := range []string{"h1", "h2"} {
		if pl := got[id]; pl.BoardID != "4569682" || pl.How != PlacedByName {
			t.Fatalf("%s placed as %+v, want 4569682 by name", id, pl)
		}
	}
}
