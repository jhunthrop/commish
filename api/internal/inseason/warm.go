package inseason

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// WarmTimeout bounds one landed read's warm run: every account following
// the league, each its trade search.
const WarmTimeout = 30 * time.Second

// Landed is a league read that just landed, as one account following it
// reads it.
type Landed struct {
	Account uuid.UUID
	League  League
}

// Landings is every account's league for a read that just landed.
// SyncLeagues implements it.
type Landings interface {
	Landed(ctx context.Context, ref leaguesync.Ref) ([]Landed, error)
}

// Landed is every live link's league for the read, as each account's
// route would follow it.
func (l SyncLeagues) Landed(ctx context.Context, ref leaguesync.Ref) ([]Landed, error) {
	followed, err := l.Sync.FollowedAt(ctx, ref)
	if err != nil {
		return nil, err
	}
	out := make([]Landed, 0, len(followed))
	for _, f := range followed {
		out = append(out, Landed{Account: f.Link.AccountID, League: leagueOf(f)})
	}
	return out, nil
}

// OnLanded is leaguesync.Poller.Landed for this service: the read's warm
// run on its own goroutine and deadline, so the read that landed is never
// held up by it (coordinator's ruling, Lane 66u).
func (s *Service) OnLanded(snap leaguesync.Snapshot) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), WarmTimeout)
		defer cancel()
		s.Warm(ctx, snap.Ref)
	}()
}

// Warm runs the trade search for every account following a league whose
// read just landed, so no member waits for it: the search is kept per
// league read (readCache), a request that arrives while it runs shares the
// run, and a read that fails lands nothing, so the search kept for the
// read before stands. A league the screens refuse (no saved scoring, no
// current week) is left to its route.
func (s *Service) Warm(ctx context.Context, ref leaguesync.Ref) {
	if s.Landings == nil {
		return
	}
	landed, err := s.Landings.Landed(ctx, ref)
	if err != nil {
		s.Log.Warn("inseason: warm the trade search", "league", ref.Key(), "err", err)
		return
	}
	for _, l := range landed {
		if l.League.Saved == nil || l.League.Snap.Week == 0 {
			continue
		}
		a, err := s.leagueAdvisor(ctx, l.League, l.Account)
		if err != nil {
			s.Log.Warn("inseason: warm the trade search", "league", ref.Key(), "err", err)
			continue
		}
		a.found()
	}
}
