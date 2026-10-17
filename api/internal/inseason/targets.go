package inseason

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"golang.org/x/sync/singleflight"
)

// maxTargetReads bounds the targets kept; past it the cache starts over.
const maxTargetReads = 256

// targetCache keeps the trade finder's targets per league read (review 66j
// M10): a search keystroke, a position chip or Show more reads the same
// targets, and a new league read, a refreshed order or a changed Hold tag
// reads them again. The finder runs outside the lock, which guards the map
// only, so one read's finder never holds up another's (review 66j N4), and
// asks of the same read at once share one run. The zero value is ready.
type targetCache struct {
	mu      sync.Mutex
	read    map[string]map[string]bool
	running singleflight.Group
}

// readKey names one league read as the finder sees it: the account, the
// league, the drafter's roster, when the league and the order were read,
// and the players the drafter holds.
func readKey(a *advisor, account string) string {
	held := make([]string, 0, len(a.held))
	for id, on := range a.held {
		if on {
			held = append(held, id)
		}
	}
	sort.Strings(held)
	return fmt.Sprintf("%s|%s|%s|%d|%d|%d|%s", account, a.Snap.Ref.Host, a.Snap.Ref.LeagueID, a.Me,
		a.Snap.ReadAt.UnixNano(), a.Board.Refreshed.UnixNano(), strings.Join(held, ","))
}

// get is the targets for a read, running find once for it.
func (c *targetCache) get(key string, find func() map[string]bool) map[string]bool {
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
	targets, _ := got.(map[string]bool)
	return targets
}

// lookup is the targets kept for a read, under the lock.
func (c *targetCache) lookup(key string) (map[string]bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	got, ok := c.read[key]
	return got, ok
}

// store keeps a read's targets, under the lock; past maxTargetReads the
// cache starts over.
func (c *targetCache) store(key string, targets map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.read == nil || len(c.read) >= maxTargetReads {
		c.read = map[string]map[string]bool{}
	}
	c.read[key] = targets
}

// targetsFor is the read's targets, found at most once per league read and
// only when a row asks.
func (s *Service) targetsFor(a *advisor, account string) Targets {
	var once sync.Once
	var got map[string]bool
	return func() map[string]bool {
		once.Do(func() { got = s.targets.get(readKey(a, account), a.tradeTargets) })
		return got
	}
}
