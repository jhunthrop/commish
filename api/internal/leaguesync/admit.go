package leaguesync

import (
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// A read of a league nobody has attached costs the host a whole read on
// a caller's say-so, so it is bounded twice: each account may ask about
// NewLeaguesPerHour distinct leagues an hour (asking again about one it
// already asked about is free), and each host serves at most a few such
// reads at once, a refusal with a sentence past that. A linked league
// and one this process already holds pass straight through.
const (
	NewLeaguesPerHour = 5
	newLeagueWindow   = time.Hour
	// maxAskers is how many accounts are kept before the hour's old asks
	// are swept from all of them.
	maxAskers = 4096
)

// hostQueueCap is how many reads of new leagues each host serves at
// once: MyFantasyLeague's one second a request makes a whole read about
// seven seconds, so two at a time is a fair share of its gap.
func hostQueueCap() map[string]int {
	return map[string]int{HostSleeper: 8, HostMFL: 2}
}

// Errors an admission answers.
var (
	// ErrTooManyNew is an account past its new leagues for the hour.
	ErrTooManyNew = errors.New("leaguesync: too many new leagues this hour")
	// ErrBusy is a host serving as many new leagues as it may at once.
	ErrBusy = errors.New("leaguesync: host busy")
)

// Admission bounds reads of leagues nobody has attached. It is per
// process.
type Admission struct {
	Now func() time.Time

	mu      sync.Mutex
	asked   map[uuid.UUID]map[string]time.Time
	running map[string]int
}

// Admit lets the account read a new league, or says why not. release
// must be called when the read is over.
func (a *Admission) Admit(account uuid.UUID, ref Ref) (release func(), err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.asked == nil {
		a.asked, a.running = map[uuid.UUID]map[string]time.Time{}, map[string]int{}
	}
	now := a.Now()
	if len(a.asked) > maxAskers {
		a.sweep(now)
	}
	mine := a.asked[account]
	if mine == nil {
		mine = map[string]time.Time{}
		a.asked[account] = mine
	}
	for key, at := range mine {
		if now.Sub(at) >= newLeagueWindow {
			delete(mine, key)
		}
	}
	key := ref.Key()
	if _, again := mine[key]; !again && len(mine) >= NewLeaguesPerHour {
		return nil, ErrTooManyNew
	}
	if a.running[ref.Host] >= hostQueueCap()[ref.Host] {
		return nil, ErrBusy
	}
	if _, again := mine[key]; !again {
		mine[key] = now
	}
	a.running[ref.Host]++
	var once sync.Once
	return func() {
		once.Do(func() {
			a.mu.Lock()
			a.running[ref.Host]--
			a.mu.Unlock()
		})
	}, nil
}

// sweep forgets every ask older than the window, with a.mu held.
func (a *Admission) sweep(now time.Time) {
	for account, asks := range a.asked {
		for key, at := range asks {
			if now.Sub(at) >= newLeagueWindow {
				delete(asks, key)
			}
		}
		if len(asks) == 0 {
			delete(a.asked, account)
		}
	}
}
