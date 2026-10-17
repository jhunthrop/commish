package boards

import (
	"context"
	"fmt"
	"time"
)

// The in-season tools' reads (spec 2026-10-15 §9): the season's stat
// lines by player-week, the team-week schedule with its kickoffs and
// final flags, and the newest injury capture. Each is parameterised and
// capped; a read over its cap is an error, never a silent cut.

// StatLineSource is the research store's weekly stat line ingest
// (research/pipeline/nflverse/stat_lines.py STAT_LINE_SOURCE).
const StatLineSource = "nflverse_player_week"

// StatMetrics are the stat line metrics ScoringRules score: domain.py's
// fourteen STAT_FIELDS, its optional ones a rule scores (the two-point
// conversions, the misses, the return touchdowns, a defense's fumble
// recoveries, safeties and points and yards allowed), and a kicker's makes
// from 40 to 49 and from 50, counted inside field_goals_made (Lane 70a
// writes a kicker's and a team defense's results under these names). A
// metric the store does not hold reads as absent, never as zero.
func StatMetrics() []string {
	return []string{
		"passing_yards", "passing_touchdowns", "interceptions", "rushing_yards", "rushing_touchdowns",
		"receiving_yards", "receiving_touchdowns", "receptions", "fumbles_lost", "field_goals_made",
		"extra_points_made", "sacks", "defensive_interceptions", "defensive_touchdowns",
		"two_point_conversions", "field_goals_missed", "extra_points_missed", "kick_return_touchdowns",
		"punt_return_touchdowns", "defensive_fumbles_recovered", "safeties", "points_allowed", "yards_allowed",
		"field_goals_made_40_49", "field_goals_made_50_plus",
	}
}

// Read caps: a whole season is about 600 lined players a week for 18
// weeks and 272 games.
const (
	maxStatLines     = 20000
	maxTeamWeeks     = 1200
	scheduleSource   = "nflverse_kickoff"
	kickoffMetric    = "kickoff_instant"
	gameResultMetric = "game_result"
)

// nflverseTeams folds nflverse's spellings onto the provider's codes the
// board uses (research/pipeline/nflverse/team_codes.py).
func nflverseTeams() map[string]string {
	return map[string]string{"LA": "LAR", "WAS": "WSH", "STL": "LAR", "SD": "LAC", "OAK": "LV"}
}

// ProductTeam is a team in the board's codes.
func ProductTeam(code string) string {
	if t, ok := nflverseTeams()[code]; ok {
		return t
	}
	return code
}

// StatLine is one player's line for one week, keyed by the board's id.
type StatLine struct {
	PlayerID string
	Position string
	Week     int
	// Team is the club he played for that week, in the board's codes,
	// empty when the store does not say.
	Team    string
	Metrics map[string]float64
}

// StatLines is the season's lines, the newest observation of each
// metric winning.
func (s *PGSource) StatLines(ctx context.Context, season int) ([]StatLine, error) {
	query := `with latest as (
  select distinct on (week, player_id, metric) week, player_id, metric, value
  from ` + s.table("player_week_observations") + `
  where season = $1 and source = $2 and metric = any($3)
  order by week, player_id, metric, as_of desc
), lines as (
  select week, player_id, array_agg(metric order by metric) as metrics, array_agg(value order by metric) as vals
  from latest group by week, player_id
), teams as (
  select distinct on (week, player_id) week, player_id, team
  from ` + s.table("player_week_teams") + ` where season = $1
  order by week, player_id, as_of desc
)
select c.provider_player_id, pp.position, l.week, coalesce(t.team, ''), l.metrics, l.vals
from lines l
join ` + s.table("player_crosswalk") + ` c on c.player_id = l.player_id
join ` + s.table("provider_players") + ` pp on pp.id = c.provider_player_id
left join teams t on t.week = l.week and t.player_id = l.player_id
order by c.provider_player_id collate "C", l.week limit $4`
	rows, err := s.Pool.Query(ctx, query, season, StatLineSource, StatMetrics(), maxStatLines+1)
	if err != nil {
		return nil, fmt.Errorf("boards: read stat lines %d: %w", season, err)
	}
	defer rows.Close()
	var out []StatLine
	for rows.Next() {
		var l StatLine
		var metrics []string
		var vals []float64
		if err := rows.Scan(&l.PlayerID, &l.Position, &l.Week, &l.Team, &metrics, &vals); err != nil {
			return nil, fmt.Errorf("boards: scan stat lines %d: %w", season, err)
		}
		if len(metrics) != len(vals) {
			return nil, fmt.Errorf("boards: stat line %s week %d: %d metrics, %d values", l.PlayerID, l.Week, len(metrics), len(vals))
		}
		l.Team = ProductTeam(l.Team)
		l.Metrics = make(map[string]float64, len(metrics))
		for i, m := range metrics {
			l.Metrics[m] = vals[i]
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read stat lines %d: %w", season, err)
	}
	if len(out) > maxStatLines {
		return nil, fmt.Errorf("boards: over %d stat lines for %d", maxStatLines, season)
	}
	return out, nil
}

// TeamWeek is one club's game in one week.
type TeamWeek struct {
	Week     int
	Team     string
	Opponent string
	Home     bool
	// Kickoff is the game's kickoff instant: the store's kickoff
	// observation, else the provider schedule's date and Eastern time.
	Kickoff time.Time
	// Final says the store holds the game's result.
	Final bool
}

// Schedule is the season's games, each from both clubs' sides: the
// provider's schedule for the pairing, the research store's team-week
// observations for the kickoff instant and the final flag (the freeze
// and game-log steps' reads).
func (s *PGSource) Schedule(ctx context.Context, season int) ([]TeamWeek, error) {
	games, err := s.games(ctx, season)
	if err != nil {
		return nil, err
	}
	kickoffs, finals, err := s.teamWeekFacts(ctx, season)
	if err != nil {
		return nil, err
	}
	out := make([]TeamWeek, 0, len(games))
	for _, g := range games {
		key := teamWeekKey(g.Week, g.Team)
		if at, ok := kickoffs[key]; ok {
			g.Kickoff = at
		}
		g.Final = finals[key]
		out = append(out, g)
	}
	return out, nil
}

func teamWeekKey(week int, team string) string { return fmt.Sprintf("%d|%s", week, team) }

// games is the provider's schedule from both sides, kickoffs from its
// date and Eastern time.
func (s *PGSource) games(ctx context.Context, season int) ([]TeamWeek, error) {
	rows, err := s.Pool.Query(ctx, `select week, home_team, away_team, game_date, coalesce(kickoff_et, '')
		from `+s.table("provider_games")+` where season = $1 and game_date is not null
		order by week, home_team collate "C" limit $2`, season, maxTeamWeeks+1)
	if err != nil {
		return nil, fmt.Errorf("boards: read schedule %d: %w", season, err)
	}
	defer rows.Close()
	var out []TeamWeek
	for rows.Next() {
		var week int
		var home, away, kickoffET string
		var date time.Time
		if err := rows.Scan(&week, &home, &away, &date, &kickoffET); err != nil {
			return nil, fmt.Errorf("boards: scan schedule %d: %w", season, err)
		}
		at, err := KickoffAt(date, kickoffET)
		if err != nil {
			// A time the schedule has not set ("TBD"): the start of the
			// game's day, the earliest it could start.
			at, _ = KickoffAt(date, "")
		}
		out = append(out,
			TeamWeek{Week: week, Team: home, Opponent: away, Home: true, Kickoff: at},
			TeamWeek{Week: week, Team: away, Opponent: home, Home: false, Kickoff: at})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read schedule %d: %w", season, err)
	}
	if len(out) > 2*maxTeamWeeks {
		return nil, fmt.Errorf("boards: over %d games for %d", maxTeamWeeks, season)
	}
	return out, nil
}

// teamWeekFacts is each club-week's kickoff instant (the observation's
// stamp) and whether its result is stored.
func (s *PGSource) teamWeekFacts(ctx context.Context, season int) (map[string]time.Time, map[string]bool, error) {
	rows, err := s.Pool.Query(ctx, `select week, team, metric, max(as_of) from `+s.table("team_week_observations")+`
		where season = $1 and source = $2 and metric = any($3) group by week, team, metric
		order by week, team collate "C", metric limit $4`, season, scheduleSource, []string{kickoffMetric, gameResultMetric}, 2*maxTeamWeeks+1)
	if err != nil {
		return nil, nil, fmt.Errorf("boards: read team weeks %d: %w", season, err)
	}
	defer rows.Close()
	kickoffs, finals := map[string]time.Time{}, map[string]bool{}
	n := 0
	for rows.Next() {
		var week int
		var team, metric string
		var at time.Time
		if err := rows.Scan(&week, &team, &metric, &at); err != nil {
			return nil, nil, fmt.Errorf("boards: scan team weeks %d: %w", season, err)
		}
		n++
		key := teamWeekKey(week, ProductTeam(team))
		if metric == kickoffMetric {
			kickoffs[key] = at.UTC()
		} else {
			finals[key] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("boards: read team weeks %d: %w", season, err)
	}
	if n > 2*maxTeamWeeks {
		return nil, nil, fmt.Errorf("boards: over %d team-week facts for %d", 2*maxTeamWeeks, season)
	}
	return kickoffs, finals, nil
}
