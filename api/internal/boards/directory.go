package boards

import (
	"context"
	"fmt"
	"time"
)

// Projection is one player's season on a board the api did not read
// from the stored table: the boards service's answer, keyed by the
// universe id the research boards key on.
type Projection struct {
	Points  float64
	Floor   float64
	Median  float64
	Ceiling float64
}

// maxHostIDs bounds the id map one read takes in.
const maxHostIDs = 20000

// SleeperIDs is Sleeper's player id to the provider id the boards name
// players by: players.sleeper_id (revision 0005) through the crosswalk.
func (s *PGSource) SleeperIDs(ctx context.Context) (map[string]string, error) {
	return s.hostIDs(ctx, sleeperIDColumn)
}

// YahooIDs is Yahoo's player id to the provider id the boards name
// players by: players.yahoo_id (revision 0005, DynastyProcess's id map)
// through the crosswalk.
func (s *PGSource) YahooIDs(ctx context.Context) (map[string]string, error) {
	return s.hostIDs(ctx, yahooIDColumn)
}

// The players table's host id columns hostIDs reads, never a caller's.
const (
	sleeperIDColumn = "sleeper_id"
	yahooIDColumn   = "yahoo_id"
)

// hostIDs is one host id column to the provider ids, refused whole when
// one host id crosses to two provider players.
func (s *PGSource) hostIDs(ctx context.Context, column string) (map[string]string, error) {
	if column != sleeperIDColumn && column != yahooIDColumn {
		return nil, fmt.Errorf("boards: no host id column %q", column)
	}
	rows, err := s.Pool.Query(ctx, `select p.`+column+`, c.provider_player_id from `+s.table("players")+` p
join `+s.table("player_crosswalk")+` c on c.player_id = p.id where p.`+column+` is not null
order by p.`+column+`, c.provider_player_id limit `+fmt.Sprint(maxHostIDs+1))
	if err != nil {
		return nil, fmt.Errorf("boards: read %s: %w", column, err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var hostID, id string
		if err := rows.Scan(&hostID, &id); err != nil {
			return nil, fmt.Errorf("boards: scan %s: %w", column, err)
		}
		if _, twice := out[hostID]; twice {
			// Two provider ids for one player: the crosswalk is wrong, and a
			// pick placed on either would be a guess.
			return nil, fmt.Errorf("boards: %s %s crosses to two provider players", column, hostID)
		}
		out[hostID] = id
	}
	if len(out) > maxHostIDs {
		return nil, fmt.Errorf("boards: over %d %s values; the map is not the one expected", maxHostIDs, column)
	}
	return out, rows.Err()
}

// directoryQuery is the provider's roster (the ids the product names
// players by) in ADP order, each with the universe id the boards key on
// through the crosswalk, empty where the crosswalk has none, and whether
// he has a face (faceRead). A free
// agent's club is NULL (revision 0018, Lane 123) and reads as no club,
// "" (WireClub).
func (s *PGSource) directoryQuery(fr faceRead) string {
	return `select pp.id, pp.name, pp.position, coalesce(pp.team, ''), ` + fr.column() + `, pp.adp, coalesce(c.player_id, '')
from ` + s.table("provider_players") + ` pp left join ` + s.table("player_crosswalk") + ` c on c.provider_player_id = pp.id` + fr.join(s) + `
order by pp.adp asc nulls last, pp.id collate "C"`
}

// LoadScored is the directory with points from a board scored elsewhere
// (the boards service), in the same pool order Load answers.
func (s *PGSource) LoadScored(ctx context.Context, f Format, source string, asOf time.Time, points map[string]Projection) (*Raw, error) {
	byes, err := s.byes(ctx)
	if err != nil {
		return nil, err
	}
	fr, err := s.faces(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, s.directoryQuery(fr))
	if err != nil {
		return nil, fmt.Errorf("boards: read the directory: %w", err)
	}
	defer rows.Close()
	raw := &Raw{Format: f, Season: s.Season, Source: source, AsOf: asOf.UTC(), Order: OrderPreseason, Custom: true}
	for rows.Next() {
		var p Player
		var position, universe string
		var hasFace bool
		if err := rows.Scan(&p.ID, &p.Name, &position, &p.Team, &hasFace, &p.ADP, &universe); err != nil {
			return nil, fmt.Errorf("boards: scan the directory: %w", err)
		}
		p.Headshot = fr.face(p.ID, hasFace)
		if !directoryPlayer(&p, position, byes) {
			continue
		}
		if proj, ok := points[universe]; ok && universe != "" {
			pts := proj.Points
			p.Points = &pts
			p.Range = &Range{Floor: proj.Floor, Median: proj.Median, Ceiling: proj.Ceiling}
		}
		raw.Players = append(raw.Players, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read the directory: %w", err)
	}
	return raw, nil
}
