package leaguesync

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/companion"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A host's player directory is read at most once a day (both hosts ask
// that it be read rarely), or once an hour when a roster names a player
// the kept copy lacks, a signing since the last read. Until a host's
// directory has been read once, a failed read is tried again after a
// minute, and the views wait for it rather than show a league of
// strangers.
const (
	directoryTTL     = 24 * time.Hour
	directoryMissing = time.Hour
	directoryRetry   = time.Minute
	// directoryTimeout bounds one whole directory read, Sleeper's 15 MB.
	directoryTimeout = time.Minute
)

// ErrNoDirectory is a host whose players have never been read.
var ErrNoDirectory = fmt.Errorf("%w: no player directory yet", ErrUnavailable)

// PlayerStore keeps each host's directory (app.host_players), so a
// restart does not read it again.
type PlayerStore interface {
	HostPlayers(ctx context.Context, host string) ([]HostPlayer, time.Time, error)
	PutHostPlayers(ctx context.Context, host string, players []HostPlayer, at time.Time) error
}

type directoryEntry struct {
	mu     sync.Mutex
	byID   map[string]HostPlayer
	readAt time.Time
	tried  time.Time
	fromDB bool
	// reading is closed when the read in flight lands; nil when none is.
	reading chan struct{}
}

// Directory is each host's players by id.
type Directory struct {
	Hosts Hosts
	Store PlayerStore
	Now   func() time.Time
	Log   *slog.Logger

	mu      sync.Mutex
	entries map[string]*directoryEntry
}

func (d *Directory) entry(host string) *directoryEntry {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.entries == nil {
		d.entries = map[string]*directoryEntry{}
	}
	e, ok := d.entries[host]
	if !ok {
		e = &directoryEntry{}
		d.entries[host] = e
	}
	return e
}

// Warm reads every host's directory now, from the store or the host, so
// the first view after a start finds it.
func (d *Directory) Warm(ctx context.Context, season int) {
	for _, h := range d.Hosts {
		if _, err := d.For(ctx, h.Key(), season, nil); err != nil {
			d.Log.Warn("leaguesync: warm directory", "host", h.Key(), "err", err)
		}
	}
}

// For is the host's directory, covering need when the host can. The read
// runs outside the entry's lock: views go on with the kept copy while it
// runs, and wait for it only when there is no copy yet.
func (d *Directory) For(ctx context.Context, host string, season int, need []string) (map[string]HostPlayer, error) {
	h, ok := d.Hosts.ByKey(host)
	if !ok {
		return nil, fmt.Errorf("leaguesync: no host %q", host)
	}
	e := d.entry(host)
	e.mu.Lock()
	d.load(ctx, e, host)
	now := d.Now()
	if e.reading == nil && d.stale(e, now, need) {
		e.tried, e.reading = now, make(chan struct{})
		go d.read(e, h, season, now)
	}
	byID, reading := e.byID, e.reading
	e.mu.Unlock()
	if byID != nil {
		return byID, nil
	}
	if reading == nil {
		return nil, ErrNoDirectory
	}
	select {
	case <-reading:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.byID == nil {
		return nil, ErrNoDirectory
	}
	return e.byID, nil
}

// load reads the kept copy once a process; a failed load is tried again.
func (d *Directory) load(ctx context.Context, e *directoryEntry, host string) {
	if e.fromDB {
		return
	}
	players, at, err := d.Store.HostPlayers(context.WithoutCancel(ctx), host)
	if err != nil {
		d.Log.Warn("leaguesync: stored directory", "host", host, "err", err)
		return
	}
	e.fromDB = true
	if len(players) > 0 {
		e.byID, e.readAt = index(players), at
	}
}

// read reads the host's directory and keeps it, outside the entry's lock.
func (d *Directory) read(e *directoryEntry, h Host, season int, now time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), directoryTimeout)
	defer cancel()
	players, err := h.Players(ctx, season)
	e.mu.Lock()
	if err == nil {
		e.byID, e.readAt = index(players), now
	}
	close(e.reading)
	e.reading = nil
	e.mu.Unlock()
	if err != nil {
		d.Log.Warn("leaguesync: directory read", "host", h.Key(), "err", err)
		return
	}
	if err := d.Store.PutHostPlayers(ctx, h.Key(), players, now); err != nil {
		d.Log.Warn("leaguesync: keep directory", "host", h.Key(), "err", err)
	}
}

// stale says whether the directory should be read again: never read and
// not tried in the last minute, older than a day, or missing a player a
// roster names and not tried in the last hour.
func (d *Directory) stale(e *directoryEntry, now time.Time, need []string) bool {
	if e.byID == nil {
		return e.tried.IsZero() || now.Sub(e.tried) >= directoryRetry
	}
	if now.Sub(e.readAt) >= directoryTTL && now.Sub(e.tried) >= directoryMissing {
		return true
	}
	if now.Sub(e.tried) < directoryMissing || now.Sub(e.readAt) < directoryMissing {
		return false
	}
	for _, id := range need {
		if _, ok := e.byID[id]; !ok {
			return true
		}
	}
	return false
}

func index(players []HostPlayer) map[string]HostPlayer {
	m := make(map[string]HostPlayer, len(players))
	for _, p := range players {
		m[p.ID] = p
	}
	return m
}

// How a host's player was placed on our board, counted in the report.
const (
	PlacedByESPN    = "espn"
	PlacedByDefense = "defense"
	PlacedByName    = "name"
)

// Placement is a host player's board id and how it was found.
type Placement struct {
	BoardID string
	How     string
}

// teamCodes are the hosts' team codes that differ from our board's.
func teamCodes() map[string]string {
	return map[string]string{
		"KCC": "KC", "GBP": "GB", "NEP": "NE", "NOS": "NO", "SFO": "SF", "TBB": "TB", "LVR": "LV",
		"JAC": "JAX", "WAS": "WSH",
	}
}

func ourTeam(code string) string {
	if t, ok := teamCodes()[code]; ok {
		return t
	}
	return code
}

// Place puts each host player named in ids on our board: by his ESPN
// id (our board's ids are the stats provider's, which are ESPN's), a
// defense by its team, and otherwise by name and position as the live
// draft companion does, a name two of our players share never guessed.
// A player found no way is left out of the answer: unplaced.
func Place(raw *boards.Raw, dir map[string]HostPlayer, ids []string) map[string]Placement {
	byID := map[string]boards.Player{}
	defense := map[string]string{}
	byName := map[string]string{}
	for _, p := range raw.Players {
		byID[p.ID] = p
		if p.Position == draft.DEF {
			defense[p.Team] = p.ID
			continue
		}
		key := string(p.Position) + "|" + companion.FoldName(p.Name)
		if prev, ok := byName[key]; ok && prev != p.ID {
			byName[key] = ""
			continue
		}
		byName[key] = p.ID
	}
	out := make(map[string]Placement, len(ids))
	for _, id := range ids {
		hp, ok := dir[id]
		if !ok {
			continue
		}
		if pl, ok := placeOne(hp, byID, defense, byName); ok {
			out[id] = pl
		}
	}
	return out
}

func placeOne(hp HostPlayer, byID map[string]boards.Player, defense, byName map[string]string) (Placement, bool) {
	if hp.Position == string(draft.DEF) {
		team := hp.Team
		if team == "" {
			team = hp.ID
		}
		id, ok := defense[ourTeam(team)]
		return Placement{BoardID: id, How: PlacedByDefense}, ok
	}
	if p, ok := byID[hp.ESPNID]; ok && hp.ESPNID != "" && string(p.Position) == hp.Position {
		return Placement{BoardID: p.ID, How: PlacedByESPN}, true
	}
	if id := byName[hp.Position+"|"+companion.FoldName(hp.Name)]; id != "" {
		return Placement{BoardID: id, How: PlacedByName}, true
	}
	return Placement{}, false
}
