package leaguesync

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// KeptWeeks is the league read's kept schedule weeks, in week order
// (Lane 298, app.league_schedule_weeks).
func (s *Store) KeptWeeks(ctx context.Context, ref Ref) ([]KeptWeek, error) {
	rows, err := s.Pool.Query(ctx, `select week, games, final, confirmed, read_at from app.league_schedule_weeks
		where host = $1 and host_league_id = $2 and host_season = $3 and read_as = $4 order by week`,
		ref.Host, ref.LeagueID, ref.Season, ref.As)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: kept weeks %s: %w", ref.Key(), err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (KeptWeek, error) {
		var w KeptWeek
		var raw []byte
		if err := r.Scan(&w.Week, &raw, &w.Final, &w.Confirmed, &w.ReadAt); err != nil {
			return KeptWeek{}, err
		}
		return w, json.Unmarshal(raw, &w.Games)
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: kept weeks %s: %w", ref.Key(), err)
	}
	return out, nil
}

// PutWeeks replaces each week's row of the league read in one
// transaction, the earlier read of each week retired with it; nothing is
// kept for a league no account has linked.
func (s *Store) PutWeeks(ctx context.Context, ref Ref, weeks []KeptWeek) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, w := range weeks {
			games := w.Games
			if games == nil {
				games = []ScheduledGame{}
			}
			raw, err := json.Marshal(games)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `insert into app.league_schedule_weeks
				(host, host_league_id, host_season, read_as, week, games, final, confirmed, read_at)
				select $1, $2, $3, $4, $5, $6, $7, $9, $8
				where exists (select 1 from app.league_links where host = $1 and host_league_id = $2 and host_season = $3
					and `+linkedAs+`)
				on conflict (host, host_league_id, host_season, read_as, week)
				do update set games = excluded.games, final = excluded.final, confirmed = excluded.confirmed,
					read_at = excluded.read_at`,
				ref.Host, ref.LeagueID, ref.Season, ref.As, w.Week, raw, w.Final, w.ReadAt, w.Confirmed); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("leaguesync: keep weeks %s: %w", ref.Key(), err)
	}
	return nil
}
