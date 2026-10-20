package leaguerecord

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Store keeps ESPN's week reads (app.espn_week_reads).
type Store struct {
	Pool *pgxpool.Pool
}

// Leagues is every attached ESPN league of the season once (Lane 93 review
// M2: a league attached for another season is not read), each read as a member who
// attached it to be read as themselves and is connected, else as the
// public reads it.
func (s *Store) Leagues(ctx context.Context, season int) ([]leaguesync.Ref, error) {
	rows, err := s.Pool.Query(ctx, `select distinct on (l.host_league_id, l.host_season) l.host_league_id, l.host_season,
	  case when l.read_as_member and c.account_id is not null then l.account_id end
	from app.league_links l
	left join app.host_connections c on c.account_id = l.account_id and c.host = l.host and c.status = 'connected'
	where l.host = 'espn' and l.detached_at is null and l.host_season = $1
	order by l.host_league_id, l.host_season, (l.read_as_member and c.account_id is not null) desc, l.attached_at`, season)
	if err != nil {
		return nil, fmt.Errorf("leaguerecord: espn leagues: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (leaguesync.Ref, error) {
		ref := leaguesync.Ref{Host: leaguesync.HostESPN}
		var as *uuid.UUID
		err := r.Scan(&ref.LeagueID, &ref.Season, &as)
		if as != nil {
			ref.As = *as
		}
		return ref, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguerecord: espn leagues: %w", err)
	}
	return out, nil
}

// Put keeps one read whole at the instant: every rostered player's row
// for each period the read carries, the period asked and the one before.
func (s *Store) Put(ctx context.Context, leagueID string, w espn.WeekRead, at time.Time) (int, error) {
	batch := &pgx.Batch{}
	for _, team := range w.Teams {
		for _, p := range team.Players {
			for week, points := range p.Points {
				batch.Queue(`insert into app.espn_week_reads
	(league_id, season, week, read_at, read_period, player_id, team_id, slot, position, pro_team, status, projected, actual)
	values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
					leagueID, w.Season, week, at, w.Period, p.ID, team.ID, p.Slot, p.Position, p.Team, p.Status, points.Projected, points.Actual)
			}
		}
	}
	n := batch.Len()
	if n == 0 {
		return 0, nil
	}
	if err := s.Pool.SendBatch(ctx, batch).Close(); err != nil {
		return 0, fmt.Errorf("leaguerecord: put %s: %w", leagueID, err)
	}
	return n, nil
}

// Row is one player's line in one read.
type Row struct {
	Week       int
	ReadAt     time.Time
	ReadPeriod int
	PlayerID   string
	TeamID     int
	Slot       int
	Position   string
	ProTeam    string
	Status     string
	Projected  *float64
	Actual     *float64
}

// Reads is every row the store keeps for a league's season, in read order.
func (s *Store) Reads(ctx context.Context, leagueID string, season int) ([]Row, error) {
	rows, err := s.Pool.Query(ctx, `select week, read_at, read_period, player_id, team_id, slot, position, pro_team, status, projected, actual
	from app.espn_week_reads where league_id = $1 and season = $2 order by read_at, week, player_id`, leagueID, season)
	if err != nil {
		return nil, fmt.Errorf("leaguerecord: reads %s: %w", leagueID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) {
		var row Row
		err := r.Scan(&row.Week, &row.ReadAt, &row.ReadPeriod, &row.PlayerID, &row.TeamID, &row.Slot, &row.Position,
			&row.ProTeam, &row.Status, &row.Projected, &row.Actual)
		return row, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguerecord: reads %s: %w", leagueID, err)
	}
	return out, nil
}
