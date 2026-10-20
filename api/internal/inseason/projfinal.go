package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// projectedFinal is a side's projected final (Lane 92, B22), one rule for
// the score bug, the Matchup's sides and the Lineup: its points so far as
// the platform scores them, plus for each starter in play the rest of his
// projection, max(0, Proj - his Pts) (round 2, L6), plus the week
// projection of each starter still to play, each as printed to the
// tenth, a starter out counting nothing. Where the platform gives no
// player's points (FFPC, Yahoo) a starter in play adds nothing more.
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
		if f.Bye || f.GameState == nil || sitsOut(f) {
			continue
		}
		switch *f.GameState {
		case apitypes.GameStateUpcoming:
			if l.WeekProjection == nil {
				return nil
			}
			sum += roundTenth(*l.WeekProjection)
		case apitypes.GameStateKickedOff:
			sum += restOfProjection(l)
		}
	}
	total := roundTenth(sum)
	return &total
}

// restOfProjection is what a starter in play is still projected to add:
// his Proj less his points so far, never below zero; nothing where the
// platform gives no player's points or he has no Proj.
func restOfProjection(l apitypes.PlayerLine) float64 {
	if l.WeekProjection == nil || l.Facts.PointsThisWeek == nil {
		return 0
	}
	return max(0, roundTenth(*l.WeekProjection)-*l.Facts.PointsThisWeek)
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
