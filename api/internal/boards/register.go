package boards

import (
	"context"
	"fmt"
	"time"
)

// ShippedSource is the register's board for the order the site ships in
// season (research/model/register/freeze.py SHIPPED_SOURCE, Lane 93): the
// published run's rest-of-season board as each week's freeze kept it.
const ShippedSource = "commish_ros_shipped_ppr_12"

// servedSource is the board every freeze keeps (research's SERVED_SOURCE):
// its latest freeze instant is the week's latest freeze.
const servedSource = "commish_board_v9_ppr_12"

// SetOrder is one week's order as the register set it before the week's
// first kickoff, read back for a member's league (Lane 93, ruling 6).
type SetOrder struct {
	Week  int
	SetAt time.Time
	// GradedAt is the register's latest grading of the week, nil until the
	// week is graded.
	GradedAt *time.Time
	// Rank is each player's place in the order the site shipped, by his
	// ESPN id; a player the order did not list is absent.
	Rank map[string]int
	// Published is the week's published projection in PPR where the freeze
	// kept it, by ESPN id.
	Published map[string]float64
}

// SetOrders is every week of the season whose latest freeze kept the
// order the site shipped, in week order. A role that cannot read the
// register answers none, with one warning (readable).
func (s *PGSource) SetOrders(ctx context.Context, season int) ([]SetOrder, error) {
	ok, err := s.readable(ctx, "register_freeze_rows", "register_grade_rows", "players")
	if err != nil || !ok {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `with latest as (
  select week, max(frozen_at) as frozen_at from `+s.table("register_freeze_rows")+`
  where season = $1 and board_source = $2 group by week
)
select f.week, f.frozen_at, p.espn_id, f.board_rank, f.published_points,
  (select max(g.graded_at) from `+s.table("register_grade_rows")+` g
   where g.season = f.season and g.week = f.week and g.frozen_at = f.frozen_at and g.board_source = f.board_source)
from `+s.table("register_freeze_rows")+` f
join latest l on l.week = f.week and l.frozen_at = f.frozen_at
join `+s.table("players")+` p on p.id = f.player_id
where f.season = $1 and f.board_source = $3 and p.espn_id is not null
order by f.week`, season, servedSource, ShippedSource)
	if err != nil {
		return nil, fmt.Errorf("boards: set orders %d: %w", season, err)
	}
	defer rows.Close()
	var out []SetOrder
	for rows.Next() {
		var (
			week      int
			setAt     time.Time
			espnID    string
			rank      int
			published *float64
			graded    *time.Time
		)
		if err := rows.Scan(&week, &setAt, &espnID, &rank, &published, &graded); err != nil {
			return nil, fmt.Errorf("boards: set orders %d: %w", season, err)
		}
		if len(out) == 0 || out[len(out)-1].Week != week {
			out = append(out, SetOrder{Week: week, SetAt: setAt, GradedAt: graded, Rank: map[string]int{}, Published: map[string]float64{}})
		}
		last := &out[len(out)-1]
		last.Rank[espnID] = rank
		if published != nil {
			last.Published[espnID] = *published
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: set orders %d: %w", season, err)
	}
	return out, nil
}
