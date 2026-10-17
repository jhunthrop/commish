package boards

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The week's published projection (Lane 66d): the provider's weekly
// projection the harvest captures per kickoff slot
// (research/pipeline/tank01/projections.py, tank01_projection_rows), the
// newest snapshot for the week. A player's row is keyed by the provider's
// id, the board's own id, and kept only for a player in our universe
// (provider_players); a team defense's row by its club. The screens show
// it as the week's projection until our own weekly model passes its test,
// and never name the provider.

// DefensePosition is a team defense's position in the rows
// (projections.py DEFENSE_POSITION).
const DefensePosition = "DEF"

// maxProjectionRows bounds the read: one snapshot is about 400 players
// and 32 defenses.
const maxProjectionRows = 2000

// ProjectedPoints is one row's points in each scoring format.
type ProjectedPoints struct {
	PPR      float64
	Half     float64
	Standard float64
}

// For is the points in the format a preset scores most like: a tight end
// premium is PPR for the rest.
func (p ProjectedPoints) For(preset apitypes.ScoringPreset) float64 {
	switch preset {
	case apitypes.ScoringPresetHalfPpr:
		return p.Half
	case apitypes.ScoringPresetStandard:
		return p.Standard
	default:
		return p.PPR
	}
}

// WeekProjection is one week's newest snapshot: zero ReadAt and empty
// maps when none is stored or the table cannot be read.
type WeekProjection struct {
	Week   int
	ReadAt time.Time
	// Players is each player's points by board id.
	Players map[string]ProjectedPoints
	// Defenses is each team defense's points by club, in the board's codes.
	Defenses map[string]ProjectedPoints
}

// Player is a player's points: a team defense's by his club, anyone
// else's by his board id.
func (w WeekProjection) Player(boardID, position, team string) (ProjectedPoints, bool) {
	if position == DefensePosition {
		p, ok := w.Defenses[ProductTeam(team)]
		return p, ok
	}
	if boardID == "" {
		return ProjectedPoints{}, false
	}
	p, ok := w.Players[boardID]
	return p, ok
}

// WeekProjection is the newest stored snapshot of the week's projection.
func (s *PGSource) WeekProjection(ctx context.Context, season, week int) (WeekProjection, error) {
	out := WeekProjection{Week: week, Players: map[string]ProjectedPoints{}, Defenses: map[string]ProjectedPoints{}}
	readable, err := s.readable(ctx, "tank01_projection_rows", "provider_players")
	if err != nil || !readable {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `with newest as (
  select snapshot_id, captured_at from `+s.table("tank01_projection_rows")+`
  where season = $1 and week = $2 order by captured_at desc, snapshot_id desc limit 1
)
select r.provider_player_id, r.position, r.team, r.ppr_points, r.half_points, r.standard_points, n.captured_at
from `+s.table("tank01_projection_rows")+` r join newest n on n.snapshot_id = r.snapshot_id
left join `+s.table("provider_players")+` pp on pp.id = r.provider_player_id
where r.position = $3 or pp.id is not null
order by r.provider_player_id collate "C" limit $4`, season, week, DefensePosition, maxProjectionRows+1)
	if err != nil {
		return out, fmt.Errorf("boards: read week %d projection: %w", week, err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, position, team string
		var p ProjectedPoints
		var at time.Time
		if err := rows.Scan(&id, &position, &team, &p.PPR, &p.Half, &p.Standard, &at); err != nil {
			return out, fmt.Errorf("boards: scan week %d projection: %w", week, err)
		}
		n++
		out.ReadAt = at.UTC()
		if position == DefensePosition {
			out.Defenses[ProductTeam(team)] = p
		} else {
			out.Players[id] = p
		}
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("boards: read week %d projection: %w", week, err)
	}
	if n > maxProjectionRows {
		return out, fmt.Errorf("boards: over %d projection rows for week %d", maxProjectionRows, week)
	}
	return out, nil
}
