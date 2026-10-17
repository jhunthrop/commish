package inseason

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// maxTargetReads bounds the targets kept; past it the cache starts over.
const maxTargetReads = 256

// targetCache keeps the trade finder's targets per league read (review 66j
// M10): a search keystroke, a position chip or Show more reads the same
// targets, and a new league read, a refreshed order or a changed Hold tag
// reads them again. The zero value is ready.
type targetCache struct {
	mu   sync.Mutex
	read map[string]map[string]bool
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
	c.mu.Lock()
	defer c.mu.Unlock()
	if got, ok := c.read[key]; ok {
		return got
	}
	got := find()
	if c.read == nil || len(c.read) >= maxTargetReads {
		c.read = map[string]map[string]bool{}
	}
	c.read[key] = got
	return got
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
