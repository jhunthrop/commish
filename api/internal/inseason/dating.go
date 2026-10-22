package inseason

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// readCapture is an injury capture as the cache holds it, dated or not,
// with when it was read: a dated pair is as fresh as its capture, never
// as the dating (Lane 133 ruling 2, Lane 129 review MEDIUM-1).
type readCapture struct {
	designations map[string]boards.Designation
	at           time.Time
}

// withRuns is the capture dated by runs, as fresh as the capture.
func (r readCapture) withRuns(runs map[boards.RunKey]time.Time) readCapture {
	return readCapture{designations: boards.WithSince(r.designations, runs), at: r.at}
}

// DatedDesignations is the newest injury capture with each designation's
// run start (Listed) and each season-long one dated by it: the in-season
// screens' read and the board route's (solo.DesignationSource), kept for
// CaptureTTL.
//
// A capture and its dating are one value, read together and refreshed
// behind together (Lane 112 fix round 1): the previous pair answers until
// the new pair lands, so a request never waits on an hourly capture and is
// never handed a capture without its own dating. An undated week's status
// reads as carried over on a turned week (Season.carriedOver), so a status
// new this hour must never be served undated while its date can be read.
//
// No request waits on a dating (Lane 129): with no pair kept, or the one
// kept past PairMaxAge, the capture alone answers marked DatingPending
// (Lane 116, B91), so a row says the designation alone, never "still
// listed" or carried over, while its dating is read behind it; a dating
// that fails is tried again DatingRetryAfter later, never by each request.
//
// The dating is shared (Lane 133, B110): with no pair kept, the request
// first looks for the capture's dating in Datings (one keyed read, once
// per capture), so an instance answers dated at once whenever any
// instance has dated the newest capture; it answers pending only while
// none has. A pair's age is its capture's: a dating that lands late never
// makes an old capture read as new.
func (c *Cache) DatedDesignations(ctx context.Context) (map[string]boards.Designation, error) {
	if e, ok := c.kept(datedKey); ok {
		pair := e.value.(readCapture)
		if age := c.Now().Sub(pair.at); age <= PairMaxAge {
			if age > CaptureTTL {
				c.dateBehind(c.readDated)
			}
			return pair.designations, nil
		}
	}
	captured, err := cached(c, ctx, captureKey, CaptureTTL, c.readCapture)
	if err != nil {
		return nil, err
	}
	if pair, ok := c.sharedPair(ctx, captured); ok {
		return pair.designations, nil
	}
	if c.Now().Sub(captured.at) > CaptureTTL {
		// The capture kept is refreshing behind: date the newest one, not
		// the one kept (Lane 129 review MEDIUM-1).
		c.dateBehind(c.readDated)
	} else {
		c.dateBehind(func(ctx context.Context) (readCapture, error) { return c.dated(ctx, captured) })
	}
	return boards.DatingPending(captured.designations), nil
}

// dateBehind reads the dated pair behind the requests (refreshBehind)
// under the dating's own bound and retry.
func (c *Cache) dateBehind(read func(context.Context) (readCapture, error)) {
	refreshBehind(c, datedKey, refresh{
		timeout: c.datingTimeout(), retryAfter: DatingRetryAfter,
		failed: "inseason: the designation runs were not read; the statuses answer pending until the next try",
	}, read)
}

// readCapture reads the newest capture, stamped when the read began.
func (c *Cache) readCapture(ctx context.Context) (readCapture, error) {
	at := c.Now()
	designations, err := c.Reads.Designations(ctx)
	if err != nil {
		return readCapture{}, err
	}
	return readCapture{designations: designations, at: at}, nil
}

// readDated reads the newest capture and then its dating. The capture is
// kept on its own as well, so a pair past PairMaxAge gives way to the
// newest capture read, not the one the cache started from.
func (c *Cache) readDated(ctx context.Context) (readCapture, error) {
	captured, err := c.readCapture(ctx)
	if err != nil {
		return readCapture{}, err
	}
	c.keep(captureKey, captured)
	return c.dated(ctx, captured)
}

// dated is the capture dated by its runs: the shared dating when an
// instance has kept one, else the runs read here and shared. A capture
// listing nobody has none to read.
func (c *Cache) dated(ctx context.Context, captured readCapture) (readCapture, error) {
	if len(captured.designations) == 0 {
		return captured, nil
	}
	digest := DatingDigest(captured.designations)
	if runs, ok := c.sharedRuns(ctx, digest, true); ok {
		return captured.withRuns(runs), nil
	}
	newest := boards.Newest(captured.designations)
	runs, err := c.Reads.DesignationRuns(ctx, newest)
	if err != nil {
		return readCapture{}, fmt.Errorf("the capture's dating: %w", err)
	}
	c.share(ctx, Dating{Digest: digest, CaptureAt: newest, Runs: runs, DatedAt: c.Now()})
	return captured.withRuns(runs), nil
}

// sharedPair is the captured capture dated by the shared dating, kept as
// the pair, found false when no instance has dated it or a request has
// already looked for it in vain. The lookup is one keyed read under the
// read bound, shared by the requests asking at once.
func (c *Cache) sharedPair(ctx context.Context, captured readCapture) (readCapture, bool) {
	if c.Datings == nil || len(captured.designations) == 0 {
		return readCapture{}, false
	}
	digest := DatingDigest(captured.designations)
	v, _, _ := c.group.Do(sharedKey+digest, func() (any, error) {
		if !c.firstLookup(digest) {
			return nil, nil
		}
		readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout())
		defer cancel()
		runs, ok := c.sharedRuns(readCtx, digest, false)
		if !ok {
			return nil, nil
		}
		pair := captured.withRuns(runs)
		c.keep(datedKey, pair)
		return pair, nil
	})
	pair, ok := v.(readCapture)
	return pair, ok
}

// firstLookup reports whether no request has looked for digest's shared
// dating yet, marking it looked for.
func (c *Cache) firstLookup(digest string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sharedTried == digest {
		return false
	}
	c.sharedTried = digest
	return true
}

// sharedRuns is the dating kept for digest, logged by the row it came
// from; a lookup that fails is logged and reads as none kept, so the
// capture is dated here instead.
func (c *Cache) sharedRuns(ctx context.Context, digest string, behind bool) (map[boards.RunKey]time.Time, bool) {
	if c.Datings == nil {
		return nil, false
	}
	start := time.Now()
	runs, ok, err := c.Datings.Dating(ctx, digest)
	if err != nil {
		c.warn("inseason: the shared dating was not read; the capture is dated here", "table", DatingsTable, "digest", digest, "err", err)
		return nil, false
	}
	if ok && c.Log != nil {
		c.Log.Info("inseason: designations dated from the shared row", "table", DatingsTable, "digest", digest,
			"runs", len(runs), "ms", time.Since(start).Milliseconds(), "behind", behind)
	}
	return runs, ok
}

// share keeps d for every instance; a write that fails is logged, the
// dating still answering here.
func (c *Cache) share(ctx context.Context, d Dating) {
	if c.Datings == nil {
		return
	}
	if err := c.Datings.KeepDating(ctx, d); err != nil {
		c.warn("inseason: the dating was not shared; other instances date the capture themselves", "table", DatingsTable, "digest", d.Digest, "err", err)
		return
	}
	if c.Log != nil {
		c.Log.Info("inseason: dating shared", "table", DatingsTable, "digest", d.Digest, "runs", len(d.Runs))
	}
}

// warn logs msg when the cache has a log.
func (c *Cache) warn(msg string, args ...any) {
	if c.Log != nil {
		c.Log.Warn(msg, args...)
	}
}
