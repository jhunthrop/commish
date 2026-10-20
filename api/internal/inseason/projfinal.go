package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// projectedFinal is a side's projected final (Lane 92, B22), one rule for
// the score bug, the Matchup's sides and the Lineup: its points so far as
// the platform scores them plus the week projection, as printed to the
// tenth, of each starter still to play, a starter out counting nothing.
// Nil before the game has kicked off (started: any starter of either side
// past kickoff; the Proj is then the figure), with the score unread, or
// while a starter still to play has no Proj (fix round 1, MEDIUM-4): a
// figure that left him out would read low, so none is printed.
func projectedFinal(points *float64, starters []apitypes.PlayerLine, started bool) *float64 {
	if points == nil || !started {
		return nil
	}
	sum := *points
	for _, l := range starters {
		f := l.Facts
		if f.Bye || f.GameState == nil || *f.GameState != apitypes.GameStateUpcoming || sitsOut(f) {
			continue
		}
		if l.WeekProjection == nil {
			return nil
		}
		sum += roundTenth(*l.WeekProjection)
	}
	total := roundTenth(sum)
	return &total
}

// anyStarted reports a starter past kickoff among the lines, by the one
// game state (gameStateAt, carried on his facts).
func anyStarted(lines []apitypes.PlayerLine) bool {
	for _, l := range lines {
		f := l.Facts
		if !f.Bye && f.GameState != nil && *f.GameState != apitypes.GameStateUpcoming {
			return true
		}
	}
	return false
}

// sidePoints is the platform's score so far for the side to the tenth,
// nil with no side or its score unread.
func sidePoints(s *leaguesync.Side) *float64 {
	if s == nil || s.PointsUnread {
		return nil
	}
	pts := roundTenth(s.Points)
	return &pts
}

// printedLines is printedSum over lines held by value.
func printedLines(lines []apitypes.PlayerLine) *float64 {
	ptrs := make([]*apitypes.PlayerLine, len(lines))
	for i := range lines {
		ptrs[i] = &lines[i]
	}
	return printedSum(ptrs)
}
