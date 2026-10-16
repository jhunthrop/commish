package boards

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// The week's game facts (Lane 66a; the round 4 preregistration §2.5 and
// §4): the game's expected score and margin from the hourly capture's
// figures (research/pipeline/tank01/lines.py, the tank01_lines source),
// the kickoff forecast (research/pipeline/nws/forecast.py, nws_forecast)
// and the venue's roof (research.stadiums, joined through the game table
// nflverse_games). Each is a fact with its read time, never a projection.

// The team-week sources and the metrics the week facts read.
const (
	LinesSource    = "tank01_lines"
	ForecastSource = "nws_forecast"

	metricSpread      = "point_spread"
	metricTotal       = "game_total"
	metricTemperature = "temperature_f"
	metricWind        = "wind_mph"
	metricChance      = "precipitation_probability"
)

// Roof kinds, the stadium table's words (research/db/schema/venues.py).
const (
	RoofOutdoors    = "outdoors"
	RoofDome        = "dome"
	RoofRetractable = "retractable"
)

// maxGameFactRows bounds the read: a season's club-weeks (18 weeks of
// 32 clubs) times the seven metrics, with room.
const maxGameFactRows = 8000

// GameFigures is the game's figures from one club's side: the expected
// total and the club's spread, positive when it is favoured.
type GameFigures struct {
	Total  float64
	Spread float64
	ReadAt time.Time
}

// Forecast is the weather service's forecast for the kickoff hour; a
// value the forecast did not hold is nil.
type Forecast struct {
	TemperatureF        *float64
	WindMph             *float64
	PrecipitationChance *float64
	ReadAt              time.Time
}

// Venue is where the game is played, as the stadium table confirms it.
type Venue struct {
	Roof   string
	Abroad bool
}

// ClubWeek names one club's game in one week, the club in the board's
// codes.
type ClubWeek struct {
	Week int
	Team string
}

// GameFact is one club's game facts for one week; a fact the store does
// not hold is nil.
type GameFact struct {
	Figures  *GameFigures
	Forecast *Forecast
	Venue    *Venue
}

// GameFacts is each club-week's game facts: the newest read of each source before the game's
// kickoff (the rule the round's replay reads with, research
// tests/test_week_facts_replay.py), and the venue.
func (s *PGSource) GameFacts(ctx context.Context, season int) (map[ClubWeek]GameFact, error) {
	out := map[ClubWeek]GameFact{}
	if err := s.readGameObservations(ctx, season, out); err != nil {
		return nil, err
	}
	if err := s.readVenues(ctx, season, out); err != nil {
		return nil, err
	}
	return out, nil
}

// readGameObservations is each club-week's newest figures and forecast
// read before its kickoff, every metric of that one read.
func (s *PGSource) readGameObservations(ctx context.Context, season int, out map[ClubWeek]GameFact) error {
	obs := s.table("team_week_observations")
	query := `with kickoffs as (
  select week, team, max(as_of) as kickoff from ` + obs + `
  where season = $1 and source = $2 and metric = $3 group by week, team
), newest as (
  select o.week, o.team, o.source, max(o.as_of) as as_of
  from ` + obs + ` o left join kickoffs k on k.week = o.week and k.team = o.team
  where o.season = $1 and o.source = any($4) and (k.kickoff is null or o.as_of < k.kickoff)
  group by o.week, o.team, o.source
)
select o.week, o.team, o.source, o.metric, o.value, o.as_of
from ` + obs + ` o join newest n on n.week = o.week and n.team = o.team and n.source = o.source and n.as_of = o.as_of
where o.season = $1 and o.metric = any($5)
order by o.week, o.team collate "C", o.source, o.metric limit $6`
	rows, err := s.Pool.Query(ctx, query, season, scheduleSource, kickoffMetric,
		[]string{LinesSource, ForecastSource},
		[]string{metricSpread, metricTotal, metricTemperature, metricWind, metricChance}, maxGameFactRows+1)
	if err != nil {
		return fmt.Errorf("boards: read game facts %d: %w", season, err)
	}
	defer rows.Close()
	type read struct {
		values map[string]float64
		at     time.Time
	}
	reads := map[ClubWeek]map[string]*read{}
	n := 0
	for rows.Next() {
		var week int
		var team, source, metric string
		var value float64
		var at time.Time
		if err := rows.Scan(&week, &team, &source, &metric, &value, &at); err != nil {
			return fmt.Errorf("boards: scan game facts %d: %w", season, err)
		}
		n++
		key := ClubWeek{week, ProductTeam(team)}
		if reads[key] == nil {
			reads[key] = map[string]*read{}
		}
		if reads[key][source] == nil {
			reads[key][source] = &read{values: map[string]float64{}, at: at.UTC()}
		}
		reads[key][source].values[metric] = value
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("boards: read game facts %d: %w", season, err)
	}
	if n > maxGameFactRows {
		return fmt.Errorf("boards: over %d game fact rows for %d", maxGameFactRows, season)
	}
	for key, sources := range reads {
		var f GameFact
		if l := sources[LinesSource]; l != nil {
			total, okTotal := l.values[metricTotal]
			spread, okSpread := l.values[metricSpread]
			if okTotal && okSpread {
				f.Figures = &GameFigures{Total: total, Spread: spread, ReadAt: l.at}
			}
		}
		if w := sources[ForecastSource]; w != nil {
			f.Forecast = &Forecast{TemperatureF: valueOf(w.values, metricTemperature), WindMph: valueOf(w.values, metricWind),
				PrecipitationChance: valueOf(w.values, metricChance), ReadAt: w.at}
		}
		out[key] = f
	}
	return nil
}

func valueOf(values map[string]float64, metric string) *float64 {
	if v, ok := values[metric]; ok {
		return &v
	}
	return nil
}

// readVenues is each club-week's venue, from both clubs' side, when the
// stadium table confirms it: a game whose venue has no row, or whose
// recorded name is none of the row's names, has no venue (research
// pipeline/stadiums.py says why the game table files a game abroad under
// a club's own id). A store before revision 0009, or a role that cannot
// read the two tables, answers no venues, never an error.
func (s *PGSource) readVenues(ctx context.Context, season int, out map[ClubWeek]GameFact) error {
	readable, err := s.readable(ctx, "nflverse_games", "stadiums")
	if err != nil || !readable {
		return err
	}
	rows, err := s.Pool.Query(ctx, `select g.week, g.home_team, g.away_team, s.roof_type, s.international
		from `+s.table("nflverse_games")+` g join `+s.table("stadiums")+` s on s.stadium_id = g.stadium_id
		where g.season = $1 and g.stadium = any(s.aliases)
		order by g.week, g.home_team collate "C" limit $2`, season, maxTeamWeeks+1)
	if err != nil {
		return fmt.Errorf("boards: read venues %d: %w", season, err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var week int
		var home, away string
		var v Venue
		if err := rows.Scan(&week, &home, &away, &v.Roof, &v.Abroad); err != nil {
			return fmt.Errorf("boards: scan venues %d: %w", season, err)
		}
		n++
		for _, team := range []string{home, away} {
			key := ClubWeek{week, ProductTeam(team)}
			f := out[key]
			venue := v
			f.Venue = &venue
			out[key] = f
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("boards: read venues %d: %w", season, err)
	}
	if n > maxTeamWeeks {
		return fmt.Errorf("boards: over %d games for %d", maxTeamWeeks, season)
	}
	return nil
}

// readable is true when every named table exists and this role may
// select from it. Asked on every read, never latched, as hasPublished
// is: the api can deploy ahead of the migration or its grant.
func (s *PGSource) readable(ctx context.Context, tables ...string) (bool, error) {
	for _, name := range tables {
		var exists, ok bool
		err := s.Pool.QueryRow(ctx, `select to_regclass($1) is not null,
  coalesce(has_table_privilege(to_regclass($1), 'select'), false)`, s.table(name)).Scan(&exists, &ok)
		if err != nil {
			return false, fmt.Errorf("boards: look for %s: %w", name, err)
		}
		if exists && !ok && s.venuesUnreadable.CompareAndSwap(false, true) {
			slog.Warn("boards: a venue table exists but this role cannot select from it; the week facts carry no roof",
				"table", s.table(name))
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}
