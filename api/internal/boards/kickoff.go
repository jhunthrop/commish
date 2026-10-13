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
	rows, err := s.Pool.Query(ctx, `select game_date, coalesce(kickoff_et, '') from `+s.table("provider_games")+`
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
