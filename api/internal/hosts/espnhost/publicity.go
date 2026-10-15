package espnhost

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

// PublicReader tells whether the public reads a league, from one read with
// no cookies. *espn.Client implements it, and so does *Publicity.
type PublicReader interface {
	Public(ctx context.Context, id string, season int) (bool, error)
}

// Bounds on what Publicity keeps: an answer for the hour, and no more
// leagues than a busy hour of connects lists. A list's checks stop at
// maxPublicChecks leagues and at publicityBudget, which keeps a connect
// well under the server's write timeout.
const (
	publicFor       = time.Hour
	maxPublicKept   = 4096
	maxPublicChecks = 10
	publicityBudget = 15 * time.Second
)

// Why a listed league carries no public or private mark, on the wire.
const (
	unmarkedPastLimit = "not_checked"
	unmarkedNoAnswer  = "no_answer"
)

// marks is what the public checks of one list found: each checked league
// public or private by id, and the ones ESPN did not answer in time. A
// listed league in neither was past maxPublicChecks.
type marks struct {
	public     map[string]bool
	unanswered map[string]bool
}

// checkList checks the list's leagues in order, up to maxPublicChecks
// and within publicityBudget. A check ESPN does not answer leaves its
// league unmarked: never a guess.
func checkList(ctx context.Context, p PublicReader, log *slog.Logger, list []espn.MyLeague, yr int) marks {
	ctx, cancel := context.WithTimeout(ctx, publicityBudget)
	defer cancel()
	m := marks{public: map[string]bool{}, unanswered: map[string]bool{}}
	for i, l := range list {
		if i >= maxPublicChecks {
			break
		}
		if ctx.Err() != nil {
			m.unanswered[l.LeagueID] = true
			continue
		}
		public, err := p.Public(ctx, l.LeagueID, yr)
		if err != nil {
			log.Warn("espnhost: public check", "league", l.LeagueID, "err", err)
			m.unanswered[l.LeagueID] = true
			continue
		}
		m.public[l.LeagueID] = public
	}
	return m
}

// first is the first listed league whose mark matches: checked private,
// or unanswered. Empty when there is none.
func (m marks) first(list []espn.MyLeague, private bool) string {
	for _, l := range list {
		public, checked := m.public[l.LeagueID]
		if (private && checked && !public) || (!private && m.unanswered[l.LeagueID]) {
			return l.LeagueID
		}
	}
	return ""
}

// mark is a league's public flag on the wire, or why it has none.
func (m marks) mark(id string) (*bool, string) {
	if public, ok := m.public[id]; ok {
		return &public, ""
	}
	if m.unanswered[id] {
		return nil, unmarkedNoAnswer
	}
	return nil, unmarkedPastLimit
}

// countPublic is how many checked leagues the public reads.
func (m marks) countPublic() int {
	n := 0
	for _, public := range m.public {
		if public {
			n++
		}
	}
	return n
}

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
