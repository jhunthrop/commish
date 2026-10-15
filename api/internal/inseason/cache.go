package inseason

import (
	"context"
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// Reads is the research store's in-season reads. *boards.PGSource
// implements it.
type Reads interface {
	StatLines(ctx context.Context, season int) ([]boards.StatLine, error)
	Schedule(ctx context.Context, season int) ([]boards.TeamWeek, error)
	Designations(ctx context.Context) (map[string]boards.Designation, error)
}

// Short TTLs (spec §9): the stat lines and the schedule move at most
// daily, the injury captures hourly.
const (
	SeasonTTL  = 15 * time.Minute
	CaptureTTL = 5 * time.Minute
)

// ReadTimeout bounds one shared read: the pool sets no statement
// timeout, and every request waiting on the read waits on it.
const ReadTimeout = 5 * time.Second

// Cache keeps the reads for their TTLs, each read once however many
// requests ask for it at the same time, as the board cache does.
type Cache struct {
	Reads Reads
	Now   func() time.Time
	// Timeout bounds each read, ReadTimeout when zero.
	Timeout time.Duration

	group   singleflight.Group
	mu      sync.Mutex
	entries map[string]entry
}

type entry struct {
	value any
	at    time.Time
}

// Data is the season's facts.
func (c *Cache) Data(ctx context.Context, season int) (Data, error) {
	lines, err := cached(c, ctx, fmt.Sprintf("lines/%d", season), SeasonTTL, func(ctx context.Context) ([]boards.StatLine, error) {
		return c.Reads.StatLines(ctx, season)
	})
	if err != nil {
		return Data{}, err
	}
	games, err := cached(c, ctx, fmt.Sprintf("games/%d", season), SeasonTTL, func(ctx context.Context) ([]boards.TeamWeek, error) {
		return c.Reads.Schedule(ctx, season)
	})
	if err != nil {
		return Data{}, err
	}
	designations, err := cached(c, ctx, "designations", CaptureTTL, c.Reads.Designations)
	if err != nil {
		return Data{}, err
	}
	return Data{Lines: lines, Games: games, Designations: designations}, nil
}

// cached is the value kept for key while younger than ttl, else read
// once for every caller waiting on it.
func cached[V any](c *Cache, ctx context.Context, key string, ttl time.Duration, read func(context.Context) (V, error)) (V, error) {
	if v, ok := c.fresh(key, ttl); ok {
		return v.(V), nil
	}
	v, err, _ := c.group.Do(key, func() (any, error) {
		// A flight that ended between the check and this call kept its
		// answer: use it rather than read again.
		if v, ok := c.fresh(key, ttl); ok {
			return v, nil
		}
		// The read is shared: one viewer leaving must not fail the rest,
		// and the read still ends within its timeout.
		readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout())
		defer cancel()
		value, err := read(readCtx)
		if err != nil {
			return nil, err
		}
		c.mu.Lock()
		if c.entries == nil {
			c.entries = map[string]entry{}
		}
		c.entries[key] = entry{value: value, at: c.Now()}
		c.mu.Unlock()
		return value, nil
	})
	if err != nil {
		var zero V
		return zero, fmt.Errorf("inseason: read %s: %w", key, err)
	}
	return v.(V), nil
}

// fresh is the value kept for key while younger than ttl.
func (c *Cache) fresh(key string, ttl time.Duration) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || c.Now().Sub(e.at) > ttl {
		return nil, false
	}
	return e.value, true
}

func (c *Cache) timeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return ReadTimeout
}
