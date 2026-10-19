package inseason

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Scoreboard is every game of the league's week (Lane 66i): each side's
// points so far as the host scores them, its starters' week projections
// summed as printed, and the game's state read from its starters'
// kickoffs. The drafter's game comes first, the rest in the host's order.
func (a *advisor) Scoreboard() apitypes.Scoreboard {
	out := apitypes.Scoreboard{Week: a.Snap.Week, ReadAt: a.Snap.ReadAt, ProjectionReadAt: a.projectionReadAt(),
		ProjectionScoring: projectionScoring(a.settings, a.preset), Games: []apitypes.ScoreboardGame{}}
	var mine []apitypes.ScoreboardGame
	for _, sides := range a.pairings() {
		g := a.scoreboardGame(sides)
		if g.Sides[0].RosterId == a.Me {
			mine = append(mine, g)
			continue
		}
		out.Games = append(out.Games, g)
	}
	out.Games = append(mine, out.Games...)
	return out
}

// pairings is the week's sides grouped by game in the host's order, the
// drafter's side first in their game; a side with no game stands alone.
func (a *advisor) pairings() [][]*leaguesync.Side {
	var out [][]*leaguesync.Side
	at := map[int]int{}
	for i := range a.Snap.Matchups {
		s := &a.Snap.Matchups[i]
		if s.Game == 0 {
			out = append(out, []*leaguesync.Side{s})
			continue
		}
		if j, ok := at[s.Game]; ok {
			if s.RosterID == a.Me {
				out[j] = append([]*leaguesync.Side{s}, out[j]...)
			} else {
				out[j] = append(out[j], s)
			}
			continue
		}
		at[s.Game] = len(out)
		out = append(out, []*leaguesync.Side{s})
	}
	return out
}

// kickoffs is one game's starters' kickoffs: how many have kicked off,
// how many are final, how many have a game, and the next to come.
type kickoffs struct {
	kicked, final, games int
	next                 *time.Time
}

// add counts one starter's game by its state (gameStateAt, carried on his
// facts), so the bug and his row never disagree on a kickoff.
func (k *kickoffs) add(f apitypes.WeekFacts) {
	if f.Bye || f.Kickoff == nil || f.GameState == nil {
		return
	}
	k.games++
	switch *f.GameState {
	case apitypes.GameStateFinal:
		k.final++
		k.kicked++
		return
	case apitypes.GameStateKickedOff:
		k.kicked++
		return
	}
	if k.next == nil || f.Kickoff.Before(*k.next) {
		at := *f.Kickoff
		k.next = &at
	}
}

// state is upcoming before any starter's game kicks off, final once
// every starter's game is, playing between.
func (k kickoffs) state() apitypes.ScoreboardGameState {
	switch {
	case k.kicked == 0:
		return apitypes.ScoreboardGameStateUpcoming
	case k.final == k.games:
		return apitypes.ScoreboardGameStateFinal
	}
	return apitypes.ScoreboardGameStatePlaying
}

func (a *advisor) scoreboardGame(sides []*leaguesync.Side) apitypes.ScoreboardGame {
	var game kickoffs
	out := apitypes.ScoreboardGame{Sides: make([]apitypes.ScoreboardSide, 0, len(sides))}
	for _, s := range sides {
		var own kickoffs
		var proj float64
		projected := false
		for _, id := range s.Starters {
			line := a.build(id, a.Player(id), s).line
			own.add(line.Facts)
			game.add(line.Facts)
			if line.WeekProjection != nil {
				proj += roundTenth(*line.WeekProjection)
				projected = true
			}
		}
		side := apitypes.ScoreboardSide{RosterId: s.RosterID, Points: roundTenth(s.Points), PointsRead: !s.PointsUnread,
			Starters: len(s.Starters), Played: own.kicked}
		if projected {
			total := roundTenth(proj)
			side.Projection = &total
		}
		out.Sides = append(out.Sides, side)
	}
	out.State, out.NextKickoff = game.state(), game.next
	return out
}
