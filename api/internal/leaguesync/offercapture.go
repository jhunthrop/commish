package leaguesync

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// The offers capture's pace (Lane 279). It rides the league's own sync
// cadence: each read of an attached league that lands (Poller.Landed)
// reads the offers of every live link it serves, at most once a link per
// OfferGap. A failed read is remembered for OfferFailFor and not tried
// again inside it, and writes nothing, so the last good read stands. The
// request path never reads a host for offers: it answers the kept read.
const (
	OfferGap     = MinUpstreamGap
	OfferFailFor = 15 * time.Minute
	// OfferTimeout bounds one landed read's offer reads, every link's.
	OfferTimeout = ReadTimeout
	// maxOfferHolds bounds the links the capture remembers; past it the
	// holds already over are forgotten.
	maxOfferHolds = 4096
)

// OfferStore is where the capture finds a league's links and keeps their
// offers. *Store implements it.
type OfferStore interface {
	LinksOf(ctx context.Context, ref Ref) ([]Link, error)
	PutOffers(ctx context.Context, link Link, offers []Offer, at time.Time) error
}

// OfferCapture reads members' pending offers as their leagues' reads land.
type OfferCapture struct {
	// Readers is the offer reader of each host whose offers are read, by
	// host key; a host with none is never read.
	Readers map[string]OfferReader
	Store   OfferStore
	Now     func() time.Time
	Log     *slog.Logger
	// Context is main's: shutdown stops every capture; nil is Background.
	Context context.Context

	mu sync.Mutex
	// until is when each link may next be read.
	until map[uuid.UUID]time.Time
	// running is the leagues whose capture is under way.
	running map[string]bool
}

// Landed is Poller.Landed for the capture: the league's offers read
// behind the read that landed, never holding it up; a league already
// being captured is not captured twice.
func (c *OfferCapture) Landed(snap Snapshot) {
	if _, ok := c.Readers[snap.Ref.Host]; !ok {
		return
	}
	key := snap.Ref.Key()
	c.mu.Lock()
	if c.running == nil {
		c.running = map[string]bool{}
	}
	if c.running[key] {
		c.mu.Unlock()
		return
	}
	c.running[key] = true
	c.mu.Unlock()
	go func() {
		defer func() {
			c.mu.Lock()
			delete(c.running, key)
			c.mu.Unlock()
		}()
		base := c.Context
		if base == nil {
			base = context.Background()
		}
		ctx, cancel := context.WithTimeout(base, OfferTimeout)
		defer cancel()
		c.Capture(ctx, snap)
	}()
}

// Capture reads the offers of each live link the league's read serves
// whose turn has come, keeping each good read and remembering each
// failure. snap is the league's read that landed.
func (c *OfferCapture) Capture(ctx context.Context, snap Snapshot) {
	ref := snap.Ref
	reader, ok := c.Readers[ref.Host]
	if !ok {
		return
	}
	links, err := c.Store.LinksOf(ctx, ref)
	if err != nil {
		c.Log.Warn("leaguesync: offers: the league's links were not read", "league", ref.Key(), "err", err)
		return
	}
	for _, link := range links {
		if ctx.Err() != nil {
			return
		}
		if !c.due(link.ID) {
			continue
		}
		c.captureLink(ctx, reader, link, snap)
	}
}

// captureLink reads and keeps one link's offers.
func (c *OfferCapture) captureLink(ctx context.Context, reader OfferReader, link Link, snap Snapshot) {
	read, err := reader.Offers(ctx, link.AccountID, link.Ref, link.RosterID, snap)
	if err != nil {
		c.hold(link.ID, OfferFailFor)
		level := slog.LevelWarn
		if errors.Is(err, ErrNotConnected) || errors.Is(err, ErrSignInAgain) {
			// The member has no working session for the host: theirs to mend.
			level = slog.LevelInfo
		}
		c.Log.Log(ctx, level, "leaguesync: offers not read, tried again later", "league", link.Ref.Key(), "link", link.ID,
			"retry_in", OfferFailFor, "err", err)
		return
	}
	c.hold(link.ID, OfferGap)
	offers := c.keepable(link, read)
	sort.Slice(offers, func(i, j int) bool { return offers[i].OfferID < offers[j].OfferID })
	if err := c.Store.PutOffers(ctx, link, offers, c.Now()); err != nil {
		c.Log.Warn("leaguesync: offers not kept", "league", link.Ref.Key(), "link", link.ID, "err", err)
	}
}

// keepable is the read's offers the store can keep, each list non-nil;
// an offer it cannot is skipped with a line naming the host and the
// offer, so one bad offer never stops the read's retire.
func (c *OfferCapture) keepable(link Link, read []Offer) []Offer {
	out := make([]Offer, 0, len(read))
	for _, o := range read {
		if why := offerProblem(o); why != "" {
			c.Log.Warn("leaguesync: an offer is skipped", "host", link.Ref.Host, "offer", o.OfferID, "link", link.ID, "why", why)
			continue
		}
		out = append(out, o.normalized())
	}
	return out
}

// due reports whether the link's turn has come.
func (c *OfferCapture) due(link uuid.UUID) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.Now().Before(c.until[link])
}

// hold keeps the link from being read again for d.
func (c *OfferCapture) hold(link uuid.UUID, d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.Now()
	if c.until == nil {
		c.until = map[uuid.UUID]time.Time{}
	}
	if len(c.until) >= maxOfferHolds {
		for id, at := range c.until {
			if !now.Before(at) {
				delete(c.until, id)
			}
		}
	}
	c.until[link] = now.Add(d)
}
