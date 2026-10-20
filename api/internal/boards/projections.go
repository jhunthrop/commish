package boards

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// The week's published projection (Lane 66d): the provider's weekly
// projection the harvest captures per kickoff slot
// (research/pipeline/tank01/projections.py, tank01_projection_rows), the
// newest snapshot for the week. A player's row is keyed by the provider's
// id, the board's own id, and kept only for a player in our universe
// (provider_players), so a fullback outside it is left out; a kicker
// ("PK", our K) is kept always and also named by his club, and a team
// defense's row is keyed by its club. The screens show
// it as the week's projection until our own weekly model passes its test,
// and never name the provider.

// DefensePosition is a team defense's position in the rows
// (projections.py DEFENSE_POSITION); KickerPosition is the provider's
// for a kicker, our K.
const (
	DefensePosition = "DEF"
	KickerPosition  = "PK"
	ourKicker       = "K"
)

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
	// Kickers is each club's kicker's points, for a club with one kicker
	// in the snapshot: a kicker our board does not place has no board id,
	// and a club fields one.
	Kickers map[string]ProjectedPoints
	// Previous is the week's snapshot before this one (Lane 66e: a row's
	// change since the read before), nil with none.
	Previous *WeekProjection
	// Earlier is every snapshot of the week before this one, newest first
	// (Earlier[0] is Previous), each with its own Previous: the one a game
	// past its kickoff reads (AsOf, Lane 92).
	Earlier []WeekProjection
}

// AsOf is the week's projection as it stood at an instant (Lane 92, B27):
// the newest snapshot captured at or before it, with the snapshot before
// it as its Previous. A game past its kickoff keeps its projection as of
// kickoff, so its row never moves after the game has started. With none
// captured by then (a week whose first capture came after the kickoff) it
// holds no row: a snapshot from after the kickoff is never called as of
// kickoff (fix round 1, L3).
func (w WeekProjection) AsOf(at time.Time) WeekProjection {
	if !w.ReadAt.After(at) {
		return w
	}
	for _, e := range w.Earlier {
		if !e.ReadAt.After(at) {
			return e
		}
	}
	return emptyProjection(w.Week)
}

// Player is a player's points: a team defense's by his club, anyone
// else's by his board id, and a kicker with no board id (one our board
// does not place) by his club's one kicker. A kicker with a board id the
// snapshot left out has none: never a teammate's (review L1).
func (w WeekProjection) Player(boardID, position, team string) (ProjectedPoints, bool) {
	if position == DefensePosition {
		p, ok := w.Defenses[ProductTeam(team)]
		return p, ok
	}
	if boardID != "" {
		p, ok := w.Players[boardID]
		return p, ok
	}
	if position == ourKicker {
		p, ok := w.Kickers[ProductTeam(team)]
		return p, ok
	}
	return ProjectedPoints{}, false
}

// WeekProjection is the newest stored snapshot of the week's projection,
// with the snapshot before it as Previous, in one read.
func (s *PGSource) WeekProjection(ctx context.Context, season, week int) (WeekProjection, error) {
	out := emptyProjection(week)
	readable, err := s.readable(ctx, "tank01_projection_rows", "provider_players")
	if err != nil || !readable {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `with newest as (
  select snapshot_id, max(captured_at) as captured_at from `+s.table("tank01_projection_rows")+`
  where season = $1 and week = $2 group by snapshot_id order by max(captured_at) desc, snapshot_id desc limit $5
)
select r.provider_player_id, r.position, r.team, r.ppr_points, r.half_points, r.standard_points, n.captured_at, r.snapshot_id
from `+s.table("tank01_projection_rows")+` r join newest n on n.snapshot_id = r.snapshot_id
left join `+s.table("provider_players")+` pp on pp.id = r.provider_player_id
where r.position = any($3) or pp.id is not null
order by n.captured_at desc, r.snapshot_id desc, r.provider_player_id collate "C" limit $4`, season, week,
		[]string{DefensePosition, KickerPosition}, snapshotsRead*maxProjectionRows+1, snapshotsRead)
	if err != nil {
		return out, fmt.Errorf("boards: read week %d projection: %w", week, err)
	}
	defer rows.Close()
	n := 0
	// Every snapshot of the week, newest first, with its kickers by club.
	var snaps []WeekProjection
	var kickers []map[string]int
	current := int64(-1)
	for rows.Next() {
		var id, position, team string
		var p ProjectedPoints
		var at time.Time
		var snapshot int64
		if err := rows.Scan(&id, &position, &team, &p.PPR, &p.Half, &p.Standard, &at, &snapshot); err != nil {
			return out, fmt.Errorf("boards: scan week %d projection: %w", week, err)
		}
		n++
		if len(snaps) == 0 || snapshot != current {
			current = snapshot
			snaps = append(snaps, emptyProjection(week))
			kickers = append(kickers, map[string]int{})
		}
		last := len(snaps) - 1
		snaps[last].add(id, position, team, p, at, kickers[last])
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("boards: read week %d projection: %w", week, err)
	}
	if n > snapshotsRead*maxProjectionRows {
		return out, fmt.Errorf("boards: over %d projection rows for week %d", snapshotsRead*maxProjectionRows, week)
	}
	if len(snaps) == 0 {
		return out, nil
	}
	return chained(snaps, kickers), nil
}

// chained is the snapshots, newest first, each with the one before it as
// its Previous, the newest with every earlier one as Earlier.
func chained(snaps []WeekProjection, kickers []map[string]int) WeekProjection {
	for i := range snaps {
		snaps[i].dropSharedKickers(kickers[i])
	}
	for i := len(snaps) - 2; i >= 0; i-- {
		before := snaps[i+1]
		snaps[i].Previous = &before
	}
	out := snaps[0]
	out.Earlier = snaps[1:]
	return out
}

// snapshotsRead bounds the week's snapshots read: the harvest captures
// one per kickoff slot (four to six a week), with room for retakes.
const snapshotsRead = 16

func emptyProjection(week int) WeekProjection {
	return WeekProjection{Week: week, Players: map[string]ProjectedPoints{}, Defenses: map[string]ProjectedPoints{},
		Kickers: map[string]ProjectedPoints{}}
}

// add files one row: a defense by its club, a kicker by his id and his
// club, anyone else by his id.
func (w *WeekProjection) add(id, position, team string, p ProjectedPoints, at time.Time, kickers map[string]int) {
	w.ReadAt = at.UTC()
	club := ProductTeam(team)
	switch position {
	case DefensePosition:
		w.Defenses[club] = p
	case KickerPosition:
		w.Players[id] = p
		w.Kickers[club] = p
		kickers[club]++
	default:
		w.Players[id] = p
	}
}

// dropSharedKickers names no kicker by a club with two in the snapshot.
func (w *WeekProjection) dropSharedKickers(kickers map[string]int) {
	for club, count := range kickers {
		if count > 1 {
			delete(w.Kickers, club)
		}
	}
}

// Delta is a player's change in points since the snapshot before, in the
// preset's format, from the tenths the screens print (so a change never
// disagrees with the two figures shown); false without a row in both.
func (w WeekProjection) Delta(boardID, position, team string, preset apitypes.ScoringPreset) (float64, bool) {
	if w.Previous == nil {
		return 0, false
	}
	now, ok := w.Player(boardID, position, team)
	if !ok {
		return 0, false
	}
	then, ok := w.Previous.Player(boardID, position, team)
	if !ok {
		return 0, false
	}
	// The difference of the tenths the screens print, by the site's one rule
	// (tenth.Round), itself a clean tenth (Lane 66k rereview N3).
	return tenth.Round(tenth.Round(now.For(preset)) - tenth.Round(then.For(preset))), true
}
