package boards

import (
	"context"
	"fmt"
	"time"
)

// Kickers and defenses rank in draft order (the 2026-09-05 ruling), and
// the room takes the same order the site's board prints: each format's own
// stamped ADP capture (research.adp_snapshots, the Fantasy Football
// Calculator feed the nightly reads for that format), the newest at or
// before the season's first kickoff (before it, now), keyed on the
// provider id through the crosswalk (research/nightly/reads/market.py).
// A kicker or defense that capture does not price follows the ones it
// does, by id; the site's board leaves him off, the room keeps him so
// every seat can fill its K and DEF spots. Every other position keeps the
// provider's ADP. A schema without a readable adp_snapshots reads the
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

// cte is the format's capture, by provider id; empty when off.
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

// adp is a row's ADP: a kicker's or a defense's from the format's
// capture, everyone else's from the provider.
func (m marketRead) adp() string {
	if !m.on {
		return "pp.adp"
	}
	return `(case when pp.position in ('K', 'DEF') then mk.adp else pp.adp end)`
}

func (m marketRead) join() string {
	if !m.on {
		return ""
	}
	return ` left join market mk on mk.player_id = pp.id`
}

// columns is one directory row with its board points, the columns Load
// scans ahead of the board's stamp, order and run.
func (m marketRead) columns() string {
	return `pp.id, pp.name, pp.position, pp.team, coalesce(pp.headshot_url, ''), ` + m.adp() + `,
  board.points, board.floor_points, board.median_points, board.ceiling_points`
}

// order is the pool's: by ADP, then by id.
func (m marketRead) order() string {
	return `
order by ` + m.adp() + ` asc nulls last, pp.id collate "C"`
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
