package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// projectedFinal is a side's projected final (Lane 92, B22), one rule for
// the score bug, the Matchup's sides and the Lineup: its points so far as
// the platform scores them plus the week projection, as printed to the
// tenth, of each starter still to play, a starter out counting nothing.
// Nil before any of the starters has kicked off (the Proj is then the
// figure) or with the score unread.
func projectedFinal(points *float64, starters []apitypes.PlayerLine) *float64 {
	if points == nil {
		return nil
	}
	started := false
	sum := *points
	for _, l := range starters {
		f := l.Facts
		if f.Bye || f.GameState == nil {
			continue
		}
		if *f.GameState != apitypes.GameStateUpcoming {
			started = true
			continue
		}
		if !sitsOut(f) && l.WeekProjection != nil {
			sum += roundTenth(*l.WeekProjection)
		}
	}
	if !started {
		return nil
	}
	total := roundTenth(sum)
	return &total
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
