package inseason

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"golang.org/x/sync/singleflight"
)

// maxReads bounds the league reads a cache keeps; past it the cache
// starts over.
const maxReads = 256

// readCache keeps one value per league read (review 66j M10, Lane 66u
// N3): the trade finder's trades, so a /trades request, its ?player=
// narrowing and every order read of the same league read reuse one
// search, and a new league read, a refreshed order, a new projection read
// or a changed Hold tag searches again. The search runs outside the lock,
// which guards the map only, so one read's search never holds up
// another's (review 66j N4), and asks of the same read at once share one
// run. The zero value is ready.
type readCache[T any] struct {
	mu      sync.Mutex
	read    map[string]T
	running singleflight.Group
}

// readKey names one league read as the finder sees it: the account, the
// league, the drafter's roster, when the league, the order and the week's
// projection were read (the drop follows this week's lineup, Lane 66u),
// and the players the drafter holds.
func readKey(a *advisor, account string) string {
	held := make([]string, 0, len(a.held))
	for id, on := range a.held {
		if on {
			held = append(held, id)
		}
	}
	sort.Strings(held)
	return fmt.Sprintf("%s|%s|%s|%d|%d|%d|%d|%s", account, a.Snap.Ref.Host, a.Snap.Ref.LeagueID, a.Me,
		a.Snap.ReadAt.UnixNano(), a.Board.Refreshed.UnixNano(), a.projection.ReadAt.UnixNano(), strings.Join(held, ","))
}

// get is the value for a read, running find once for it.
func (c *readCache[T]) get(key string, find func() T) T {
	if got, ok := c.lookup(key); ok {
		return got
	}
	got, _, _ := c.running.Do(key, func() (any, error) {
		if held, ok := c.lookup(key); ok {
			return held, nil
		}
		found := find()
		c.store(key, found)
		return found, nil
	})
	value, _ := got.(T)
	return value
}

// lookup is the value kept for a read, under the lock.
func (c *readCache[T]) lookup(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	got, ok := c.read[key]
	return got, ok
}

// store keeps a read's value, under the lock; past maxReads the cache
// starts over.
func (c *readCache[T]) store(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.read == nil || len(c.read) >= maxReads {
		c.read = map[string]T{}
	}
	c.read[key] = value
}

// findsFor is the read's trades by the other team's roster id, searched
// at most once per league read and only when a page asks.
func (s *Service) findsFor(a *advisor, account string) func() map[int][]Trade {
	var once sync.Once
	var got map[int][]Trade
	return func() map[int][]Trade {
		once.Do(func() { got = s.finds.get(readKey(a, account), a.findAll) })
		return got
	}
}
