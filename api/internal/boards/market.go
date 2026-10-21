package boards

import (
	"context"
	"fmt"
	"time"
)

// The room's ADP is the site's board's (Lane 66o): each format's own
// stamped ADP capture (research.adp_snapshots, the Fantasy Football
// Calculator feed the nightly reads for that format), the newest at or
// before the season's first kickoff (before it, now), keyed on the
// provider id through the crosswalk (research/nightly/reads/adp.py). Every
// position reads it, so a player's ADP in the room is the figure the
// board's ADP column prints, and kickers and defenses rank in draft order
// (the 2026-09-05 ruling) by it. A player that capture does not price has
// no ADP, as on the board. The pool still orders him after the priced
// ones, by the provider's ADP and then by id, so the bots' late rounds keep
// a sensible order. A kicker or defense the capture does not price follows
// by id alone, since the board leaves him off but every seat must fill its
// K and DEF spots. A schema without a readable adp_snapshots reads the
// provider's ADP for everyone, as before.

// adpSourceFor is the capture series a format's board is ordered by
// (research/nightly/config.py, RunFormat.adp).
func adpSourceFor(f Format) string { return fmt.Sprintf("ffc_adp_%s_12", f) }

// marketRead is the draft-order part of a board read: whether it applies,
// and the first of its two parameters (the capture series and the first
// kickoff, null when the schedule has none).
type marketRead struct {
	on    bool
	first int
}

// cte is the format's capture, by provider id; empty when off. Two rows
// that reach one provider id keep the lower ADP, the one rule the nightly
// (research/nightly/reads/adp.py, place_capture) and the oracle
// (research-ts/src/nightly/reads/adp.ts, placeCapture) share.
func (m marketRead) cte(s *PGSource) string {
	if !m.on {
		return ""
	}
	source, kickoff := fmt.Sprintf("$%d", m.first), fmt.Sprintf("$%d::timestamptz", m.first+1)
	snapshots := s.table("adp_snapshots")
	return `, market as (
  select c.provider_player_id as player_id, min(a.adp) as adp
  from ` + snapshots + ` a join ` + s.table("player_crosswalk") + ` c on c.player_id = a.player_id
  where a.source = ` + source + ` and a.captured_at = (
    select max(captured_at) from ` + snapshots + ` where source = ` + source + `
      and captured_at <= least(now(), coalesce(` + kickoff + `, now()))
  )
  group by c.provider_player_id
)`
}

// adp is a row's ADP: the format's capture's, the board's own.
func (m marketRead) adp() string {
	if !m.on {
		return "pp.adp"
	}
	return "mk.adp"
}

func (m marketRead) join() string {
	if !m.on {
		return ""
	}
	return ` left join market mk on mk.player_id = pp.id`
}

// columns is one directory row with its board points, the columns Load
// scans ahead of the board's stamp, order and run; a free agent's NULL
// club reads as no club, "" (WireClub).
func (m marketRead) columns() string {
	return `pp.id, pp.name, pp.position, coalesce(pp.team, ''), coalesce(pp.headshot_url, ''), ` + m.adp() + `,
  board.points, board.floor_points, board.median_points, board.ceiling_points`
}

// order is the pool's: by ADP, then the unpriced by the provider's ADP
// (a kicker or a defense by id alone), then by id.
func (m marketRead) order() string {
	if !m.on {
		return `
order by pp.adp asc nulls last, pp.id collate "C"`
	}
	return `
order by mk.adp asc nulls last, (case when pp.position in ('K', 'DEF') then null else pp.adp end) asc nulls last, pp.id collate "C"`
}

// marketArgs is whether the read takes the draft order from the captures,
// and its two arguments when it does.
func (s *PGSource) marketArgs(ctx context.Context, f Format) (bool, []any, error) {
	ok, err := s.readable(ctx, "adp_snapshots")
	if err != nil || !ok {
		return false, nil, err
	}
	kickoff, known, err := s.FirstKickoff(ctx, s.Season)
	if err != nil {
		return false, nil, err
	}
	var at *time.Time
	if known {
		at = &kickoff
	}
	return true, []any{adpSourceFor(f), at}, nil
}
