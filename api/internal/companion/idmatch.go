package companion

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// MatchSleeperID places a Sleeper pick by the player id Sleeper drafted
// him under, through players.sleeper_id (Lane 8 part A).
const MatchSleeperID = "sleeper_id"

// SleeperIDs is Sleeper's player id to our board's, from the research
// players table (boards.PGSource).
type SleeperIDs interface {
	SleeperIDs(ctx context.Context) (map[string]string, error)
}

// idLoadTimeout bounds one read of the id map: a pick is placed from the
// last map read while a new one is slow.
const idLoadTimeout = 3 * time.Second

// IDMatcher places a Sleeper pick by id, never by name: a pick whose id
// our players do not carry is unplaced, which removes nothing from the
// pool and is counted. A defense is its team, which is Sleeper's own id
// for one.
type IDMatcher struct {
	IDs   SleeperIDs
	Teams *NameMatcher
	TTL   time.Duration
	Now   func() time.Time
	Log   *slog.Logger

	mu    sync.Mutex
	ids   map[string]string
	at    time.Time
	raw   *boards.Raw
	onRaw map[string]bool
}

// Match is the board id of the host's pick, by its Sleeper id.
func (m *IDMatcher) Match(raw *boards.Raw, p sleeper.Pick) (string, string, bool) {
	if hostPosition(p.Position) == draft.DEF {
		return m.Teams.Match(raw, p)
	}
	ids, onRaw := m.state(raw)
	id, ok := ids[p.PlayerID]
	if !ok || !onRaw[id] {
		return "", "", false
	}
	return id, MatchSleeperID, true
}

// state is the id map, reread past TTL, and the board's own ids.
func (m *IDMatcher) state(raw *boards.Raw) (map[string]string, map[string]bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ids == nil || m.Now().Sub(m.at) > m.TTL {
		ctx, cancel := context.WithTimeout(context.Background(), idLoadTimeout)
		ids, err := m.IDs.SleeperIDs(ctx)
		cancel()
		switch {
		case err != nil:
			m.Log.Warn("companion: sleeper ids", "err", err, "effect", "picks are placed from the last map read")
			if m.ids == nil {
				m.ids = map[string]string{}
			}
		default:
			m.ids = ids
		}
		m.at = m.Now()
	}
	if m.raw != raw {
		m.raw, m.onRaw = raw, make(map[string]bool, len(raw.Players))
		for _, p := range raw.Players {
			m.onRaw[p.ID] = true
		}
	}
	return m.ids, m.onRaw
}
