package inseason

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// WarmTimeout bounds one landed read's warm run: each recent viewer's
// trade search in turn.
const WarmTimeout = 30 * time.Second

// warmWorkers is how many leagues' warm runs go at once, across every
// league (coordinator's ruling, rereview 66u W1).
const warmWorkers = 2

// Landed is a league read that just landed, as one account following it
// reads it.
type Landed struct {
	Account uuid.UUID
	League  League
}

// Landings is the league of each of accounts that follows a read that
// just landed. SyncLeagues implements it.
type Landings interface {
	Landed(ctx context.Context, ref leaguesync.Ref, accounts []uuid.UUID) ([]Landed, error)
}

// Landed is the league for each of accounts' live links, as each
// account's route would follow it.
func (l SyncLeagues) Landed(ctx context.Context, ref leaguesync.Ref, accounts []uuid.UUID) ([]Landed, error) {
	followed, err := l.Sync.FollowedAt(ctx, ref, accounts)
	if err != nil {
		return nil, err
	}
	out := make([]Landed, 0, len(followed))
	for _, f := range followed {
		out = append(out, Landed{Account: f.Link.AccountID, League: leagueOf(f)})
	}
	return out, nil
}

// viewerSet is the accounts that viewed each league on an in-season
// screen, when each last did: a landed read warms only theirs, inside the
// poller's own window (leaguesync.ViewWindow). The zero value is ready.
type viewerSet struct {
	mu   sync.Mutex
	seen map[string]map[uuid.UUID]time.Time
}

// saw records an account's view of the league at now.
func (v *viewerSet) saw(ref leaguesync.Ref, account uuid.UUID, now time.Time) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.seen == nil {
		v.seen = map[string]map[uuid.UUID]time.Time{}
	}
	key := ref.Key()
	if v.seen[key] == nil {
		v.seen[key] = map[uuid.UUID]time.Time{}
	}
	v.seen[key][account] = now
}

// recent is the accounts that viewed the league inside the window before
// now, the older views forgotten.
func (v *viewerSet) recent(ref leaguesync.Ref, now time.Time) []uuid.UUID {
	v.mu.Lock()
	defer v.mu.Unlock()
	key := ref.Key()
	var out []uuid.UUID
	for account, at := range v.seen[key] {
		if now.Sub(at) > leaguesync.ViewWindow {
			delete(v.seen[key], account)
			continue
		}
		out = append(out, account)
	}
	if len(v.seen[key]) == 0 {
		delete(v.seen, key)
	}
	return out
}

// warmQueue is the leagues whose reads landed, waiting for one of the
// warmWorkers: one entry per league, a newer landing superseding a queued
// one, and a league never warmed twice at once. The zero value is ready
// once started.
type warmQueue struct {
	mu      sync.Mutex
	wake    *sync.Cond
	queued  map[string]leaguesync.Ref
	order   []string
	running map[string]bool
	stopped bool
	start   sync.Once
}

// add queues the league's newest read, replacing one still waiting.
func (q *warmQueue) add(ref leaguesync.Ref) {
	q.mu.Lock()
	defer q.mu.Unlock()
	key := ref.Key()
	if _, waiting := q.queued[key]; !waiting {
		q.order = append(q.order, key)
	}
	q.queued[key] = ref
	q.wake.Signal()
}

// next is the first queued league not already running, waiting for one;
// false once the queue is stopped.
func (q *warmQueue) next() (leaguesync.Ref, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for {
		if q.stopped {
			return leaguesync.Ref{}, false
		}
		for i, key := range q.order {
			if q.running[key] {
				continue
			}
			ref := q.queued[key]
			delete(q.queued, key)
			q.order = append(q.order[:i:i], q.order[i+1:]...)
			q.running[key] = true
			return ref, true
		}
		q.wake.Wait()
	}
}

// done marks the league's run over, waking a worker for a newer landing.
func (q *warmQueue) done(ref leaguesync.Ref) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.running, ref.Key())
	q.wake.Broadcast()
}

// stop ends the workers once their runs return.
func (q *warmQueue) stop() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.stopped = true
	q.wake.Broadcast()
}

// idle reports whether no warm run waits or runs.
func (s *Service) idle() bool {
	q := &s.warms
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.order) == 0 && len(q.running) == 0
}

// base is the service's context, main's: shutdown stops every search and
// warm run (rereview 66u W3).
func (s *Service) base() context.Context {
	if s.Context != nil {
		return s.Context
	}
	return context.Background()
}

// startWarms starts the workers once, and stops them with the service's
// context.
func (s *Service) startWarms() {
	s.warms.start.Do(func() {
		q := &s.warms
		q.wake = sync.NewCond(&q.mu)
		q.queued, q.running = map[string]leaguesync.Ref{}, map[string]bool{}
		ctx := s.base()
		go func() { <-ctx.Done(); q.stop() }()
		for range warmWorkers {
			go func() {
				for {
					ref, ok := q.next()
					if !ok {
						return
					}
					run, cancel := context.WithTimeout(ctx, WarmTimeout)
					s.Warm(run, ref)
					cancel()
					q.done(ref)
				}
			}()
		}
	})
}

// OnLanded is leaguesync.Poller.Landed for this service: the league's
// warm run queued for the workers, so the read that landed is never held
// up by it (coordinator's ruling, Lane 66u).
func (s *Service) OnLanded(snap leaguesync.Snapshot) {
	s.startWarms()
	s.warms.add(snap.Ref)
}

// Warm runs the trade search for each account that viewed a league whose
// read just landed, inside the view window, so they do not wait for it: a
// pair's search is kept while what it reads is unchanged (readCache), a
// request that arrives while it runs shares the run, and a read that
// fails lands nothing, so the search kept for the read before stands. A
// league the screens refuse (no saved scoring, no current week) is left
// to its route. ctx stops the run, with one line said.
func (s *Service) Warm(ctx context.Context, ref leaguesync.Ref) {
	if s.Landings == nil {
		return
	}
	accounts := s.viewers.recent(ref, s.Now())
	if len(accounts) == 0 {
		return
	}
	landed, err := s.Landings.Landed(ctx, ref, accounts)
	if err != nil {
		s.Log.Warn("inseason: warm the trade search", "league", ref.Key(), "err", err)
		return
	}
	for _, l := range landed {
		if ctx.Err() != nil {
			s.Log.Info("inseason: the trade search's warm run stopped", "league", ref.Key(), "err", ctx.Err())
			return
		}
		if l.League.Saved == nil || l.League.Snap.Week == 0 {
			continue
		}
		a, err := s.leagueAdvisor(ctx, l.League, l.Account, ctx)
		if err != nil {
			s.Log.Warn("inseason: warm the trade search", "league", ref.Key(), "err", err)
			continue
		}
		a.found()
	}
}
