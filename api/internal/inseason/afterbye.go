package inseason

import (
	"context"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// On his bye the player card's week tiles hold no figure, so the read
// carries his club's next game (Lane 100, B30): its opponent's rank against
// his position and its published projection, or when that projection is
// first captured.

// gameAfter is the week of team's first game after week, false with none.
func gameAfter(games []boards.TeamWeek, team string, week int) (int, bool) {
	next := 0
	for _, g := range games {
		if g.Team == team && g.Week > week && (next == 0 || g.Week < next) {
			next = g.Week
		}
	}
	return next, next > 0
}

// afterBye is the next game's part of the read: that week's line, when its
// projection was captured and, while none is, when it will be.
func afterBye(week int, line apitypes.PlayerLine, games []boards.TeamWeek, projection boards.WeekProjection, now time.Time) *apitypes.PlayerAfterBye {
	read, _ := readsOf(projection)
	return &apitypes.PlayerAfterBye{Week: week, Line: line, ProjectionReadAt: read,
		ProjectionArrivesAt: projectionArrivesFor(games, week, projection, now)}
}

// publicAfterBye is the next game after his bye with no league, in PPR;
// nil off a bye or with no game left.
func (s *Service) publicAfterBye(ctx context.Context, out apitypes.PlayerWeek, d Data, b boards.Board, rest RestNow, bp boards.Player, now time.Time) *apitypes.PlayerAfterBye {
	next, ok := gameAfter(d.Games, bp.Team, out.Week)
	if !out.Line.Facts.Bye || !ok {
		return nil
	}
	projection := s.projection(ctx, s.Season, next)
	return afterBye(next, publicLine(d, projection, b, rest, bp, next, now), d.Games, projection, now)
}

// leagueAfterBye is the next game after his bye in the league's scoring,
// the advisor turned to that week; nil off a bye or with no game left.
func (s *Service) leagueAfterBye(ctx context.Context, a *advisor, out apitypes.PlayerWeek, bp boards.Player) *apitypes.PlayerAfterBye {
	next, ok := gameAfter(a.data.Games, bp.Team, out.Week)
	if !out.Line.Facts.Bye || !ok {
		return nil
	}
	turned := a.turnTo(next, s.projection(ctx, seasonOf(a.League), next))
	week, ok := turned.PlayerWeek(bp)
	if !ok {
		return nil
	}
	return afterBye(next, week.Line, turned.data.Games, turned.projection, turned.now)
}
