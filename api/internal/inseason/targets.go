package inseason

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// maxPairs bounds the (account, league, roster) pairs a cache keeps; past
// it the pair used longest ago goes.
const maxPairs = 256

// readCache keeps one value per (account, league, roster) pair: the trade
// finder's trades for that pair's latest search (rereview 66u W4), stored
// with the content they were searched on. A request, its ?player=
// narrowing, every order read and a landed read's warm run reuse it while
// the content (the rosters as the search reads them, the holds, the
// projection read, the order's refresh) is unchanged, whatever the read
// time; a change searches again and replaces the pair's entry. The search
// runs outside the lock, which guards the map only, so one pair's search
// never holds up another's (review 66j N4), and asks of the same pair and
// content at once share one run. The zero value is ready.
type readCache[T any] struct {
	mu      sync.Mutex
	pairs   map[string]pairEntry[T]
	tick    uint64
	running singleflight.Group
}

// pairEntry is one pair's latest value, the content it was found on and
// when it was last used, on the cache's own count of uses.
type pairEntry[T any] struct {
	content string
	value   T
	used    uint64
}

// get is the pair's value for content, running find once for it. A find
// that fails keeps nothing (a search a deadline stopped is no search).
func (c *readCache[T]) get(pair, content string, find func() (T, error)) (T, error) {
	if got, ok := c.lookup(pair, content); ok {
		return got, nil
	}
	got, err, _ := c.running.Do(pair+"#"+content, func() (any, error) {
		if held, ok := c.lookup(pair, content); ok {
			return held, nil
		}
		found, err := find()
		if err != nil {
			return found, err
		}
		c.store(pair, content, found)
		return found, nil
	})
	value, _ := got.(T)
	return value, err
}

// lookup is the pair's value when it was found on content, under the lock.
func (c *readCache[T]) lookup(pair, content string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.pairs[pair]
	if !ok || e.content != content {
		var zero T
		return zero, false
	}
	c.tick++
	e.used = c.tick
	c.pairs[pair] = e
	return e.value, true
}

// store keeps the pair's newest value, replacing its last; past maxPairs
// the pair used longest ago goes, never the whole map.
func (c *readCache[T]) store(pair, content string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pairs == nil {
		c.pairs = map[string]pairEntry[T]{}
	}
	if _, ok := c.pairs[pair]; !ok && len(c.pairs) >= maxPairs {
		oldest, at := "", uint64(0)
		for k, e := range c.pairs {
			if oldest == "" || e.used < at {
				oldest, at = k, e.used
			}
		}
		delete(c.pairs, oldest)
	}
	c.tick++
	c.pairs[pair] = pairEntry[T]{content: content, value: value, used: c.tick}
}

// pairKey names the pair a search is for: the account, the league as it
// is read (host, season, id, read as whom) and the drafter's roster.
func pairKey(a *advisor, account string) string {
	r := a.Snap.Ref
	return fmt.Sprintf("%s|%s|%d|%s|%s|%d", account, r.Host, r.Season, r.LeagueID, r.As, a.Me)
}

// contentKey is a hash of what the search reads (rereview 66u W1): every
// roster as the search reads it (each team's starters on the host and its
// active players with the figures and statuses the search keys on), the
// holds, the week's projection read, the order's refresh and basis, and
// the weeks the gains cover. Equal content, equal search: the read time
// alone changes nothing.
func contentKey(a *advisor) string {
	h := sha256.New()
	put := func(parts ...any) { _, _ = fmt.Fprint(h, parts...); _, _ = h.Write([]byte{0}) }
	num := func(v float64) {
		var b [8]byte
		binary.LittleEndian.PutUint64(b[:], math.Float64bits(v))
		_, _ = h.Write(b[:])
	}
	teams := append(a.Snap.Teams[:0:0], a.Snap.Teams...)
	sort.Slice(teams, func(i, j int) bool { return teams[i].RosterID < teams[j].RosterID })
	for _, t := range teams {
		put("team", t.RosterID, t.Starters)
		for _, p := range a.active(t) {
			c := p.cand
			put(c.ID, c.Position, c.Rank, c.HasValue, c.HasPerGame, c.HasProj, int(c.Tier), c.Locked, c.InjuredReserve, c.Plays)
			num(c.Value)
			num(c.PerGame)
			num(c.Proj)
			num(c.FreeLevel)
		}
	}
	held := make([]string, 0, len(a.held))
	for id, on := range a.held {
		if on {
			held = append(held, id)
		}
	}
	sort.Strings(held)
	put("held", held)
	put("read", a.projection.ReadAt.UnixNano(), a.Board.Refreshed.UnixNano(), a.basis, a.weeks)
	// The league's shape the search reads (rereview 66u F1): its slots and
	// bench (AllTrades, Squad.Open) and the saved settings they come from.
	shape, _ := json.Marshal(struct {
		Config   []draft.SlotConfig
		Settings apitypes.LeagueSettings
	}{a.config, a.settings})
	_, _ = h.Write(shape)
	return hex.EncodeToString(h.Sum(nil))
}

// searchTimeout bounds one search; a request and a warm run share it.
const searchTimeout = 30 * time.Second

// timeout is the bound on one search: Service.SearchTimeout, or
// searchTimeout when zero.
func (s *Service) timeout() time.Duration {
	if s.SearchTimeout > 0 {
		return s.SearchTimeout
	}
	return searchTimeout
}

// findsFor is the pair's trades by the other team's roster id, searched
// at most once per content and only when a page asks. The search runs on
// search, bounded by the search timeout: for a request, a context that
// outlives the drain (the service's, never cancelled, rereview 66u F2;
// requests share the run, so never one request's), for a warm the warm
// run's. A search that stops answers its error, said once by whoever
// asked.
func (s *Service) findsFor(a *advisor, account string, search context.Context) func() (map[int][]Trade, error) {
	var once sync.Once
	var got map[int][]Trade
	var failed error
	return func() (map[int][]Trade, error) {
		once.Do(func() {
			ctx, cancel := context.WithTimeout(search, s.timeout())
			defer cancel()
			pair, content := pairKey(a, account), contentKey(a)
			find := func() (map[int][]Trade, error) {
				s.searches.Add(1)
				if s.beforeSearch != nil {
					s.beforeSearch()
				}
				return a.findAll(ctx)
			}
			found, err := s.finds.get(pair, content, find)
			// A shared run another's deadline stopped is run again on ours.
			if err != nil && ctx.Err() == nil {
				found, err = s.finds.get(pair, content, find)
			}
			if err != nil {
				found, failed = nil, err
			}
			got = found
		})
		return got, failed
	}
}
