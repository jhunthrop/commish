package boards

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
)

// kickoffPattern reads the schedule's kickoff text: "8:20p", "1:00p",
// "9:30a", Eastern time.
var kickoffPattern = regexp.MustCompile(`^(\d{1,2}):(\d{2})([ap])$`)

// hoursPerHalfDay turns a 12-hour clock into a 24-hour one.
const hoursPerHalfDay = 12

// KickoffAt is a game's kickoff instant from its date and the schedule's
// Eastern kickoff text; with no kickoff text, the start of its day in
// Eastern time, the earliest it could start.
func KickoffAt(date time.Time, kickoffET string) (time.Time, error) {
	east := season.Eastern()
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, east)
	if kickoffET == "" {
		return day, nil
	}
	m := kickoffPattern.FindStringSubmatch(kickoffET)
	if m == nil {
		return time.Time{}, fmt.Errorf("boards: kickoff %q is not h:mm with a or p", kickoffET)
	}
	hour, _ := strconv.Atoi(m[1])
	minute, _ := strconv.Atoi(m[2])
	if hour < 1 || hour > hoursPerHalfDay || minute > 59 {
		return time.Time{}, fmt.Errorf("boards: kickoff %q is not a clock time", kickoffET)
	}
	hour %= hoursPerHalfDay
	if m[3] == "p" {
		hour += hoursPerHalfDay
	}
	return day.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute), nil
}

// FirstKickoff is the season's first game's kickoff instant, from the
// provider's schedule the board already reads, false while that
// season's week 1 is not loaded.
func (s *PGSource) FirstKickoff(ctx context.Context, seasonYear int) (time.Time, bool, error) {
	rows, err := s.Pool.Query(ctx, `select game_date, coalesce(kickoff_et, '') from `+s.gamesToPlay()+`
		where season = $1 and week = 1 and game_date is not null`, seasonYear)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("boards: first kickoff %d: %w", seasonYear, err)
	}
	defer rows.Close()
	var first time.Time
	for rows.Next() {
		var date time.Time
		var kickoff string
		if err := rows.Scan(&date, &kickoff); err != nil {
			return time.Time{}, false, fmt.Errorf("boards: first kickoff %d: %w", seasonYear, err)
		}
		at, err := KickoffAt(date, kickoff)
		if err != nil {
			return time.Time{}, false, err
		}
		if first.IsZero() || at.Before(first) {
			first = at
		}
	}
	if err := rows.Err(); err != nil {
		return time.Time{}, false, fmt.Errorf("boards: first kickoff %d: %w", seasonYear, err)
	}
	return first, !first.IsZero(), nil
}

// WeekAt is the NFL week a moment falls in, from the provider's schedule
// the board reads: a week runs from the day after the previous week's
// last game day to the end of its own last game day, Eastern. false when
// the season's schedule is not loaded or the moment is past its last week.
func (s *PGSource) WeekAt(ctx context.Context, seasonYear int, at time.Time) (int, bool, error) {
	rows, err := s.Pool.Query(ctx, `select week, max(game_date) from `+s.gamesToPlay()+`
		where season = $1 and game_date is not null group by week order by week`, seasonYear)
	if err != nil {
		return 0, false, fmt.Errorf("boards: week at %d: %w", seasonYear, err)
	}
	defer rows.Close()
	east := season.Eastern()
	for rows.Next() {
		var week int
		var last time.Time
		if err := rows.Scan(&week, &last); err != nil {
			return 0, false, fmt.Errorf("boards: week at %d: %w", seasonYear, err)
		}
		end := time.Date(last.Year(), last.Month(), last.Day()+1, 0, 0, 0, 0, east)
		if at.Before(end) {
			return week, true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return 0, false, fmt.Errorf("boards: week at %d: %w", seasonYear, err)
	}
	return 0, false, nil
}

// regularSeasonWeeks is the NFL's regular season: a later week in the
// schedule is a postseason game.
const regularSeasonWeeks = 18

// LastGameDay is the season's last regular-season game day, midnight
// Eastern, false while the season's schedule is not loaded.
func (s *PGSource) LastGameDay(ctx context.Context, seasonYear int) (time.Time, bool, error) {
	var last *time.Time
	err := s.Pool.QueryRow(ctx, `select max(game_date) from `+s.gamesToPlay()+`
		where season = $1 and week <= $2`, seasonYear, regularSeasonWeeks).Scan(&last)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("boards: last game day %d: %w", seasonYear, err)
	}
	if last == nil {
		return time.Time{}, false, nil
	}
	return time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, season.Eastern()), true, nil
}

// PreseasonBoard is whether a preseason board is stored for the season:
// the first one marks the end of the offseason before it.
func (s *PGSource) PreseasonBoard(ctx context.Context, seasonYear int) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from `+s.table("preseason_projections")+` where season = $1)`,
		seasonYear).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("boards: preseason board %d: %w", seasonYear, err)
	}
	return ok, nil
}
