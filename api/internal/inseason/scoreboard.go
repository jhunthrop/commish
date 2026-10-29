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
	gapBasis := gapBasisOf(out.Games, a.Me)
	out.ProjectionGapBasis = &gapBasis
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
// how many are done (final, or out of a game under way), how many games
// are final, how many are in play and still to come, how many have a
// game, and the next to come.
type kickoffs struct {
	kicked, done, finals, inPlay, toCome, games int
	next                                        *time.Time
}

// add counts one starter's game by its state (stateOfStart, from
// gameStateAt carried on his facts), so the bug and his row never disagree
// on a kickoff; a done starter has kicked off.
func (k *kickoffs) add(f apitypes.WeekFacts) {
	state := stateOfStart(f)
	if state == noGame {
		return
	}
	k.games++
	if *f.GameState == apitypes.GameStateFinal {
		k.finals++
	}
	switch state {
	case done:
		k.kicked++
		k.done++
		return
	case inPlay:
		k.kicked++
		k.inPlay++
		return
	}
	k.toCome++
	if k.next == nil || f.Kickoff.Before(*k.next) {
		at := *f.Kickoff
		k.next = &at
	}
}

// state is upcoming before any starter's game kicks off, final once
// every starter with a game is done, playing between.
func (k kickoffs) state() apitypes.ScoreboardGameState {
	switch {
	case k.kicked == 0:
		return apitypes.ScoreboardGameStateUpcoming
	case k.done == k.games:
		return apitypes.ScoreboardGameStateFinal
	}
	return apitypes.ScoreboardGameStatePlaying
}

// toPlay is the count while the game is under way (ToPlayWords): nil
// before kickoff, once the game is final, and once these starters are all
// done.
func (k kickoffs) toPlay(game apitypes.ScoreboardGameState) *string {
	if game != apitypes.ScoreboardGameStatePlaying {
		return nil
	}
	words := ToPlayWords(k.toCome, k.inPlay)
	if words == "" {
		return nil
	}
	return &words
}

// startersFinal is whether every one of these starters with a game has
// a final game (Lane 121, B99): the side's figure reads Final with its
// total, the web's one predicate (box.ts teamSmallFigure). Empty slots,
// byes and starters with no game held do not count; none with a game is
// not final. A side listing no starters at all sends none (scoreboardGame).
func (k kickoffs) startersFinal() *bool {
	final := k.games > 0 && k.finals == k.games
	return &final
}

// inPlayCount is the starters whose own game is under way now (Lane 102,
// B38): the front door's "Live now", never a starter final or still to come.
func (k kickoffs) inPlayCount() *int {
	n := k.inPlay
	return &n
}

// sitsOut is a designation that keeps him out this week (out, injured
// reserve, suspended, PUP, NFI), never questionable or doubtful: the web's
// sitsHim.
func sitsOut(f apitypes.WeekFacts) bool {
	if f.Designation == nil {
		return false
	}
	switch f.Designation.Status {
	case apitypes.DesignationStatusQuestionable, apitypes.DesignationStatusDoubtful:
		return false
	}
	return true
}

func (a *advisor) scoreboardGame(sides []*leaguesync.Side) apitypes.ScoreboardGame {
	var game kickoffs
	own := make([]kickoffs, len(sides))
	out := apitypes.ScoreboardGame{Sides: make([]apitypes.ScoreboardSide, 0, len(sides))}
	starters := make([][]apitypes.PlayerLine, len(sides))
	for i, s := range sides {
		for _, id := range s.Starters {
			line := a.build(id, a.Player(id), s).line
			own[i].add(line.Facts)
			game.add(line.Facts)
			starters[i] = append(starters[i], line)
		}
		out.Sides = append(out.Sides, apitypes.ScoreboardSide{RosterId: s.RosterID, Points: roundTenth(s.Points),
			PointsRead: !s.PointsUnread, Starters: len(s.Starters), Played: own[i].kicked, Projection: printedLines(starters[i])})
	}
	// Each side's projected final once the game has kicked off, a side none
	// of whose starters has yet included.
	for i, s := range sides {
		out.Sides[i].ProjectedFinal = projectedFinal(sidePoints(s), starters[i], game.kicked > 0)
	}
	// A side listing no starters reads by the schedule, and the game is final only once it is too
	// (Lane 124, B102); its Proj is our best lineup from its roster where the read carries one (Lane
	// 127, B105).
	unlisted := make([]*kickoffs, len(sides))
	lineups := make([][]apitypes.PlayerLine, len(sides))
	rostered := make([]bool, len(sides))
	for i, s := range sides {
		unlisted[i] = a.scheduleRead(s)
		if best, ok := a.rosterLineup(s); ok {
			lineups[i], rostered[i] = best.lines, true
			out.Sides[i].Projection, out.Sides[i].ProjectionBestLineup, out.Sides[i].BestLineupSkipped = rosterProjection(best)
		}
	}
	out.ProjectionGap = projectionGap(out.Sides)
	out.State, out.NextKickoff = gameState(game, unlisted)
	out.GameState = scoreboardGameState(out, a.now)
	// Such a side's projected final once the game reads kicked off by the bug's own rule (Lane 127
	// fix round 1); a side with no roster read keeps none (Lane 125).
	for i, s := range sides {
		if rostered[i] {
			out.Sides[i].ProjectedFinal = rosterProjectedFinal(sidePoints(s), lineups[i], out.State != apitypes.ScoreboardGameStateUpcoming, a.now)
			out.Sides[i].ProjectedFinalPaced = pacedFinal(out.Sides[i].ProjectedFinal, lineups[i], a.now)
		}
	}
	// The pooled count stays for the web before Lane 92; each side says its own.
	out.ToPlay = game.toPlay(out.State)
	for i := range out.Sides {
		out.Sides[i].ToPlay = own[i].toPlay(out.State)
		out.Sides[i].InPlay = own[i].inPlayCount()
		// A side the platform lists no starters for (FFPC's opponent view) sends no starters_final
		// (Lane 121 fix round 2, HIGH-2), its state by the schedule instead (Lane 124, B102).
		if len(sides[i].Starters) > 0 {
			out.Sides[i].StartersFinal = own[i].startersFinal()
		}
		out.Sides[i].ScheduleState = scheduleStateOf(unlisted[i])
	}
	return out
}
