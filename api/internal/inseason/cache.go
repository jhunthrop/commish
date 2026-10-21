package inseason

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// Reads is the research store's in-season reads. *boards.PGSource
// implements it.
type Reads interface {
	StatLines(ctx context.Context, season int) ([]boards.StatLine, error)
	Schedule(ctx context.Context, season int) ([]boards.TeamWeek, error)
	Designations(ctx context.Context) (map[string]boards.Designation, error)
	DesignationRuns(ctx context.Context, newest time.Time) (map[boards.RunKey]time.Time, error)
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
// requests ask for it at the same time, as the board cache does. Past
// its TTL a read is refreshed behind the value kept (cached).
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
	// refreshing is each key a refresh is reading behind its kept value,
	// refreshes the refreshes still running (a test waits on them).
	refreshing map[string]bool
	refreshes  sync.WaitGroup
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

// LiveSpan bounds a live window: a game kicked off longer ago than this
// with no final held (a final the hourly status missed) is no longer
// live, so the window never stays open for days.
const LiveSpan = 6 * time.Hour

// Live reports whether a game of the season is under way at the cache's
// clock (Lane 92, B06): kicked off by the one game state (gameStateAt),
// no final held, inside LiveSpan. The league reads wait for a fresh read
// inside it. A failed schedule read is logged and answers not live, so
// the reads keep their usual pace.
func (c *Cache) Live(ctx context.Context, season int) bool {
	games, err := cached(c, ctx, fmt.Sprintf("games/%d", season), SeasonTTL, func(ctx context.Context) ([]boards.TeamWeek, error) {
		return c.Reads.Schedule(ctx, season)
	})
	if err != nil {
		if c.Log != nil {
			c.Log.Warn("inseason: the schedule was not read; the league reads answer at their usual pace", "err", err)
		}
		return false
	}
	return liveAt(games, c.Now())
}

// liveAt reports a game kicked off at now with no final, inside LiveSpan.
func liveAt(games []boards.TeamWeek, now time.Time) bool {
	for _, g := range games {
		if gameStateAt(g, now) == apitypes.GameStateKickedOff && now.Sub(g.Kickoff) < LiveSpan {
			return true
		}
	}
	return false
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

// DatedDesignations is the same capture with each designation's run
// start (Listed) and each season-long one dated by it (the board route's
// read, solo.DesignationSource), the dating kept for CaptureTTL too. A dating
// read that fails is logged and the designations answer undated, so a
// row says "as of" rather than the board losing its statuses.
//
// The dating is kept under one key with the capture it was read for: a
// newer capture dates by the runs kept while its own are read behind
// (Lane 112 ruling 2), so an hourly capture never makes a request wait.
// A run that goes on keeps its start; a status the kept runs do not hold
// answers undated until they land.
func (c *Cache) DatedDesignations(ctx context.Context) (map[string]boards.Designation, error) {
	designations, err := c.Designations(ctx)
	if err != nil || len(designations) == 0 {
		return designations, err
	}
	newest := boards.Newest(designations)
	stale := func(e entry) bool {
		return c.Now().Sub(e.at) > CaptureTTL || !e.value.(datedRuns).newest.Equal(newest)
	}
	runs, err := cachedUnless(c, ctx, "designation-runs", stale, func(ctx context.Context) (datedRuns, error) {
		runs, err := c.Reads.DesignationRuns(ctx, newest)
		return datedRuns{newest: newest, runs: runs}, err
	})
	if err != nil {
		if c.Log != nil {
			c.Log.Warn("inseason: the designation runs were not read; the statuses answer undated", "err", err)
		}
		return designations, nil
	}
	return boards.WithSince(designations, runs.runs), nil
}

// datedRuns is the designation runs read for the capture at newest.
type datedRuns struct {
	newest time.Time
	runs   map[boards.RunKey]time.Time
}

// cached is the value kept for key while younger than ttl (cachedUnless).
func cached[V any](c *Cache, ctx context.Context, key string, ttl time.Duration, read func(context.Context) (V, error)) (V, error) {
	return cachedUnless(c, ctx, key, func(e entry) bool { return c.Now().Sub(e.at) > ttl }, read)
}

// cachedUnless is the value kept for key, read once for every caller
// waiting on it when nothing is kept. Once stale says the kept value is
// stale it still answers at once while one refresh reads it again behind
// it (Lane 112 ruling 2): a request waits on the store only when the
// cache holds nothing.
func cachedUnless[V any](c *Cache, ctx context.Context, key string, stale func(entry) bool, read func(context.Context) (V, error)) (V, error) {
	if e, ok := c.kept(key); ok {
		if stale(e) {
			refreshBehind(c, ctx, key, read)
		}
		return e.value.(V), nil
	}
	v, err, _ := c.group.Do(key, func() (any, error) {
		// A fill that ended between the check and this call kept its
		// answer: use it rather than read again.
		if e, ok := c.kept(key); ok {
			return e.value, nil
		}
		return fill(c, ctx, key, read, false)
	})
	if err != nil {
		var zero V
		return zero, fmt.Errorf("inseason: read %s: %w", key, err)
	}
	return v.(V), nil
}

// refreshBehind reads key again in the background unless a refresh of it
// is already running. A refresh that fails is logged and the kept value
// stands, so the next read past the TTL tries again.
func refreshBehind[V any](c *Cache, ctx context.Context, key string, read func(context.Context) (V, error)) {
	c.mu.Lock()
	if c.refreshing[key] {
		c.mu.Unlock()
		return
	}
	if c.refreshing == nil {
		c.refreshing = map[string]bool{}
	}
	c.refreshing[key] = true
	c.refreshes.Add(1)
	c.mu.Unlock()
	go func() {
		defer c.refreshes.Done()
		defer func() {
			c.mu.Lock()
			delete(c.refreshing, key)
			c.mu.Unlock()
		}()
		if _, err := fill(c, ctx, key, read, true); err != nil && c.Log != nil {
			c.Log.Warn("inseason: a refresh failed; the kept read answers until the next", "key", key, "err", err)
		}
	}()
}

// fill reads key and keeps the answer, logging how long the read took
// (Lane 112 ruling 4): behind is set for a refresh no request waited on.
// The read is shared: one viewer leaving must not fail the rest, and the
// read still ends within its timeout.
func fill[V any](c *Cache, ctx context.Context, key string, read func(context.Context) (V, error), behind bool) (any, error) {
	readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout())
	defer cancel()
	start := time.Now()
	value, err := read(readCtx)
	if err != nil {
		return nil, err
	}
	if c.Log != nil {
		c.Log.Info("inseason: cache fill", "key", key, "ms", time.Since(start).Milliseconds(), "behind", behind)
	}
	c.mu.Lock()
	if c.entries == nil {
		c.entries = map[string]entry{}
	}
	c.entries[key] = entry{value: value, at: c.Now()}
	c.mu.Unlock()
	return value, nil
}

// kept is the value kept for key, however old.
func (c *Cache) kept(key string) (entry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	return e, ok
}

func (c *Cache) timeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return ReadTimeout
}
