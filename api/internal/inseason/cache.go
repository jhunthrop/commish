package inseason

import (
	"context"
	"fmt"
	"log/slog"
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
	SeasonRuns(ctx context.Context, newest time.Time) (map[boards.RunKey]time.Time, error)
	GameFacts(ctx context.Context, season int) (map[boards.ClubWeek]boards.GameFact, error)
	WeekProjection(ctx context.Context, season, week int) (boards.WeekProjection, error)
}

// Short TTLs (spec §9): the stat lines and the schedule move at most
// daily, the injury captures, the game figures and the forecasts hourly.
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
	// Log takes a dating read that failed (DatedDesignations); nil
	// discards it.
	Log *slog.Logger

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
	// Dated, so a season-long status says since when on every screen
	// (review 66n finding 3): the board route's read.
	designations, err := c.DatedDesignations(ctx)
	if err != nil {
		return Data{}, err
	}
	gameFacts, err := cached(c, ctx, fmt.Sprintf("gamefacts/%d", season), CaptureTTL, func(ctx context.Context) (map[boards.ClubWeek]boards.GameFact, error) {
		return c.Reads.GameFacts(ctx, season)
	})
	if err != nil {
		return Data{}, err
	}
	return Data{Lines: lines, Games: games, Designations: designations, GameFacts: gameFacts}, nil
}

// Projection is the week's published projection, kept for CaptureTTL:
// the harvest captures it per kickoff slot.
func (c *Cache) Projection(ctx context.Context, season, week int) (boards.WeekProjection, error) {
	return cached(c, ctx, fmt.Sprintf("projection/%d/%d", season, week), CaptureTTL, func(ctx context.Context) (boards.WeekProjection, error) {
		return c.Reads.WeekProjection(ctx, season, week)
	})
}

// Designations is the newest injury capture, kept for CaptureTTL: the
// in-season screens' read, undated (they never print a since).
func (c *Cache) Designations(ctx context.Context) (map[string]boards.Designation, error) {
	return cached(c, ctx, "designations", CaptureTTL, c.Reads.Designations)
}

// DatedDesignations is the same capture with each season-long
// designation dated by its run (the board route's read,
// solo.DesignationSource), the dating kept for CaptureTTL too. A dating
// read that fails is logged and the designations answer undated, so a
// row says "as of" rather than the board losing its statuses.
func (c *Cache) DatedDesignations(ctx context.Context) (map[string]boards.Designation, error) {
	designations, err := c.Designations(ctx)
	if err != nil || len(designations) == 0 {
		return designations, err
	}
	newest := boards.Newest(designations)
	runs, err := cached(c, ctx, "season-runs/"+newest.Format(time.RFC3339Nano), CaptureTTL, func(ctx context.Context) (map[boards.RunKey]time.Time, error) {
		return c.Reads.SeasonRuns(ctx, newest)
	})
	if err != nil {
		if c.Log != nil {
			c.Log.Warn("inseason: the season-long runs were not read; the board answers its statuses undated", "err", err)
		}
		return designations, nil
	}
	return boards.WithSince(designations, runs), nil
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
