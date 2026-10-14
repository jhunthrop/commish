package companion

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// How a Sleeper pick is placed, counted in the companion's notes.
const (
	// MatchSleeperID places a pick by the player id Sleeper drafted him
	// under, through players.sleeper_id (Lane 8 part A).
	MatchSleeperID = "sleeper_id"
	// MatchSleeperName places a pick whose Sleeper id our players do not
	// carry yet (a rookie the id map lags on) by his exact name, position
	// and team, only when one board player has all three.
	MatchSleeperName = "sleeper_name"
)

// SleeperIDs is Sleeper's player id to our board's, from the research
// players table (boards.PGSource).
type SleeperIDs interface {
	SleeperIDs(ctx context.Context) (map[string]string, error)
}

// Bounds on reading the id map: one read's time, and how long a failed
// read waits before the next poll tries again.
const (
	idLoadTimeout     = 3 * time.Second
	defaultIDRetry    = 10 * time.Second
	refreshFlightName = "sleeper-ids"
)

// IDMatcher places a Sleeper pick by id: a defense by its team (Sleeper's
// own id for one), a player by players.sleeper_id, and a player whose id
// the map lacks by his exact name, position and team. A pick none of
// those place is unplaced, which removes nothing from the pool and is
// counted. The map is read outside the lock, once however many views
// ask: a failed or empty read keeps the last good map (or, with none,
// is tried again on a poll after Retry), and is never kept as fresh.
type IDMatcher struct {
	IDs   SleeperIDs
	Teams *NameMatcher
	TTL   time.Duration
	// Retry is how long a failed read waits, 10 seconds when zero.
	Retry time.Duration
	Now   func() time.Time
	Log   *slog.Logger

	refreshing singleflight.Group

	mu      sync.Mutex
	ids     map[string]string
	at      time.Time
	retryAt time.Time
	raw     *boards.Raw
	onRaw   map[string]bool
	byName  map[string]string
}

// Match is the board id of the host's pick and the rule that placed him.
func (m *IDMatcher) Match(raw *boards.Raw, p sleeper.Pick) (string, string, bool) {
	if hostPosition(p.Position) == draft.DEF {
		return m.Teams.Match(raw, p)
	}
	ids := m.current()
	onRaw, byName := m.board(raw)
	if id, mapped := ids[p.PlayerID]; mapped {
		return id, MatchSleeperID, onRaw[id]
	}
	if id := byName[nameKey(string(hostPosition(p.Position)), p.Name, p.Team)]; id != ambiguous {
		return id, MatchSleeperName, true
	}
	return "", "", false
}

func nameKey(position, name, team string) string {
	return position + "|" + name + "|" + strings.ToUpper(team)
}

// board is the board's own ids and its exact name, position and team
// index, built once a board.
func (m *IDMatcher) board(raw *boards.Raw) (map[string]bool, map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.raw != raw {
		m.raw, m.onRaw, m.byName = raw, make(map[string]bool, len(raw.Players)), map[string]string{}
		for _, p := range raw.Players {
			m.onRaw[p.ID] = true
			put(m.byName, nameKey(string(p.Position), p.Name, p.Team), p.ID)
		}
	}
	return m.onRaw, m.byName
}

// current is the id map to place picks with. Past TTL it is refreshed:
// in the background while a map is held, or by this caller (one read
// shared by every caller) when none is yet.
func (m *IDMatcher) current() map[string]string {
	m.mu.Lock()
	ids, at, retryAt := m.ids, m.at, m.retryAt
	m.mu.Unlock()
	now := m.Now()
	if (ids != nil && now.Sub(at) <= m.TTL) || now.Before(retryAt) {
		return ids
	}
	if ids != nil {
		go m.refresh()
		return ids
	}
	return m.refresh()
}

// refresh reads the map once however many callers ask, outside the lock.
func (m *IDMatcher) refresh() map[string]string {
	v, _, _ := m.refreshing.Do(refreshFlightName, func() (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), idLoadTimeout)
		ids, err := m.IDs.SleeperIDs(ctx)
		cancel()
		m.mu.Lock()
		defer m.mu.Unlock()
		if err != nil || len(ids) == 0 {
			m.retryAt = m.Now().Add(m.retry())
			m.Log.Warn("companion: sleeper ids", "err", err, "read", len(ids),
				"effect", "picks are placed from the last map read, or by name until one is read")
			return m.ids, nil
		}
		m.ids, m.at, m.retryAt = ids, m.Now(), time.Time{}
		return ids, nil
	})
	ids, _ := v.(map[string]string)
	return ids
}

func (m *IDMatcher) retry() time.Duration {
	if m.Retry > 0 {
		return m.Retry
	}
	return defaultIDRetry
}
