package espnhost

import (
	"context"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// PublicReader tells whether the public reads a league, from one read with
// no cookies. *espn.Client implements it, and so does *Publicity.
type PublicReader interface {
	Public(ctx context.Context, id string, season int) (bool, error)
}

// Bounds on what Publicity keeps: an answer for the hour, and no more
// leagues than a busy hour of connects lists.
const (
	publicFor     = time.Hour
	maxPublicKept = 4096
)

// Publicity is whether the public reads a league, read once with no
// cookies and kept for the hour in this process. A check ESPN does not
// answer is an error and is never kept, so nothing is guessed.
type Publicity struct {
	Client PublicReader
	Now    func() time.Time

	mu   sync.Mutex
	kept map[string]publicAnswer
}

type publicAnswer struct {
	public bool
	at     time.Time
}

// Public is the kept answer for the league when it is under an hour old,
// else a fresh check.
func (p *Publicity) Public(ctx context.Context, id string, season int) (bool, error) {
	key, now := hosts.FollowKey(id, season), p.Now()
	if a, ok := p.answer(key, now); ok {
		return a, nil
	}
	public, err := p.Client.Public(ctx, id, season)
	if err != nil {
		return false, err
	}
	p.keep(key, publicAnswer{public: public, at: now})
	return public, nil
}

func (p *Publicity) answer(key string, now time.Time) (bool, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.kept[key]
	if !ok || now.Sub(a.at) >= publicFor {
		return false, false
	}
	return a.public, true
}

// keep adds an answer, dropping the hour-old ones when the map is full,
// and every answer when it is still full.
func (p *Publicity) keep(key string, a publicAnswer) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.kept == nil {
		p.kept = map[string]publicAnswer{}
	}
	if len(p.kept) >= maxPublicKept {
		for k, old := range p.kept {
			if a.at.Sub(old.at) >= publicFor {
				delete(p.kept, k)
			}
		}
	}
	if len(p.kept) >= maxPublicKept {
		clear(p.kept)
	}
	p.kept[key] = a
}
