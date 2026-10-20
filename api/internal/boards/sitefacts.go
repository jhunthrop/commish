package boards

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
)

// The two facts the site's season reads beyond the regular season's
// schedule: where the postseason ends and which week the published board
// starts from.

// PostseasonEnd is the season's last postseason week and the day its
// last game is played, midnight Eastern, false while the schedule
// carries no postseason game.
func (s *PGSource) PostseasonEnd(ctx context.Context, seasonYear int) (int, time.Time, bool, error) {
	var week *int
	var last *time.Time
	err := s.Pool.QueryRow(ctx, `select max(week), max(game_date) from `+s.table("provider_games")+`
		where season = $1 and week > $2 and game_date is not null`, seasonYear, regularSeasonWeeks).Scan(&week, &last)
	if err != nil {
		return 0, time.Time{}, false, fmt.Errorf("boards: postseason end %d: %w", seasonYear, err)
	}
	if week == nil || last == nil {
		return 0, time.Time{}, false, nil
	}
	return *week, time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, season.Eastern()), true, nil
}

// BoardWeek is the first week the published rest-of-season run covers,
// the same from_week the board routes read, false while the site shows
// the preseason board (no published rows, a table or column the api has
// not reached, a preseason run, or a run that does not say).
func (s *PGSource) BoardWeek(ctx context.Context, seasonYear int) (int, bool, error) {
	published, err := s.hasPublished(ctx)
	if err != nil || !published {
		return 0, false, err
	}
	hasWeek, err := s.hasColumn(ctx, "from_week")
	if err != nil || !hasWeek {
		return 0, false, err
	}
	var week *int
	err = s.Pool.QueryRow(ctx, `select min(from_week) from `+s.table("published_boards")+`
  where season = $1 and order_basis = $2`, seasonYear, string(OrderRestOfSeason)).Scan(&week)
	if err != nil {
		return 0, false, fmt.Errorf("boards: board week %d: %w", seasonYear, err)
	}
	if week == nil || *week < 1 {
		return 0, false, nil
	}
	return *week, true, nil
}
