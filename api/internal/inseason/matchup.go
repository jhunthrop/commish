package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Matchup is the week's matchup as a box score (Lane 66d): the
// roster's side, then its opponent's when the week pairs them, each with
// its host starters in the league's slots and its bench, every player a
// line. The score and the teams stay on the sync answer. roster is the
// member's (a.Me) for their own game, or any roster the read lists for
// another game of the week (Lane 204): the one function draws both, and
// another team's game carries no standing, whose words are the member's.
func (a *advisor) Matchup(roster int) (apitypes.MatchupBox, bool) {
	team, ok := a.Snap.TeamByRoster(roster)
	if !ok {
		return apitypes.MatchupBox{}, false
	}
	viewer := apitypes.MatchupBoxViewerSideMine
	if roster != a.Me {
		viewer = apitypes.MatchupBoxViewerSideOther
	}
	first := a.side(roster)
	out := apitypes.MatchupBox{Week: a.Snap.Week, ReadAt: a.Snap.ReadAt, ProjectionReadAt: a.projectionReadAt(),
		ProjectionScoring: projectionScoring(a.settings, a.preset), ViewerSide: &viewer,
		Sides: []apitypes.MatchupBoxSide{a.boxSide(team, first)}}
	sides := []*leaguesync.Side{first}
	if opp := a.opponentOf(roster); opp != nil {
		if t, ok := a.Snap.TeamByRoster(opp.RosterID); ok {
			out.Sides = append(out.Sides, a.boxSide(t, opp))
			sides = append(sides, opp)
		}
	}
	// Each side's projected final once the game has kicked off, by the
	// score bug's rule over the same starters.
	starters := make([][]apitypes.PlayerLine, len(out.Sides))
	var all []apitypes.PlayerLine
	for i, side := range out.Sides {
		for _, s := range side.Starters {
			starters[i] = append(starters[i], s.Line)
		}
		all = append(all, starters[i]...)
	}
	started := anyStarted(all)
	var game kickoffs
	own := make([]kickoffs, len(out.Sides))
	for i := range out.Sides {
		for _, l := range starters[i] {
			own[i].add(l.Facts)
			game.add(l.Facts)
		}
	}
	// A side the platform lists no starters for reads by the schedule, the game final only once it
	// is too: the scoreboard's rule (Lane 124, B102).
	unlisted := make([]*kickoffs, len(sides))
	for i, s := range sides {
		unlisted[i] = a.scheduleRead(s)
	}
	state, _ := gameState(game, unlisted)
	for i := range out.Sides {
		out.Sides[i].ProjectedFinal = projectedFinal(sidePoints(sides[i]), starters[i], started)
		// A side listing no starters with a roster read: our best lineup's, by the bug's rule (Lane 127
		// fix round 1); its Proj the scoreboard's, by the one function (Lane 137, B107).
		if best, ok := a.rosterLineup(sides[i]); ok {
			out.Sides[i].Projection, out.Sides[i].ProjectionBestLineup, out.Sides[i].BestLineupSkipped = rosterProjection(best)
			out.Sides[i].ProjectedFinal = rosterProjectedFinal(sidePoints(sides[i]), best.lines, state != apitypes.ScoreboardGameStateUpcoming, a.now)
			out.Sides[i].ProjectedFinalPaced = pacedFinal(out.Sides[i].ProjectedFinal, best.lines, a.now)
		}
		// Each side's count by the score bug's rule (fix round 1, MEDIUM-3).
		out.Sides[i].ToPlay = own[i].toPlay(state)
		out.Sides[i].ScheduleState = scheduleStateOf(unlisted[i])
	}
	// Where the member stands, under the bug's two scores (Lane 99, B31); on another team's game
	// whether it is decided alone, the standing's words being the member's (Lane 204).
	out.Standing, out.Decided = standingFields(standingOf(state, sides, starters))
	if viewer == apitypes.MatchupBoxViewerSideOther {
		out.Standing = nil
	}
	return out, true
}

// opponentOf is the side the roster's plays this week, nil without one
// (no game, an all-play week).
func (a *advisor) opponentOf(roster int) *leaguesync.Side {
	own := a.side(roster)
	if own == nil || own.Game == 0 {
		return nil
	}
	for i := range a.Snap.Matchups {
		s := &a.Snap.Matchups[i]
		if s.Game == own.Game && s.RosterID != roster {
			return s
		}
	}
	return nil
}

// boxSide is one team's starters as its side of the matchup starts them,
// in the league's slots, and the rest of its active roster as the bench.
func (a *advisor) boxSide(t leaguesync.Team, side *leaguesync.Side) apitypes.MatchupBoxSide {
	people := a.active(t)
	cands := make([]Candidate, len(people))
	byID := make(map[string]int, len(people))
	for i, p := range people {
		cands[i] = p.cand
		byID[p.cand.ID] = i
	}
	var starters []string
	if side != nil {
		starters = side.Starters
	}
	out := apitypes.MatchupBoxSide{RosterId: t.RosterID, PlayerPoints: a.givesPlayerPoints(side), TeamTotal: leaguesync.SendsTeamTotal(a.Snap.Ref.Host), Starters: []apitypes.BoxStarter{}, Bench: []apitypes.PlayerLine{}}
	starting := map[int]bool{}
	for i, p := range hostSpots(a.config, a.slots, cands, byID, starters) {
		if p < 0 {
			continue
		}
		starting[p] = true
		out.Starters = append(out.Starters, apitypes.BoxStarter{Slot: apitypes.BoxStarterSlot(a.slots[i].Type), Line: people[p].line})
	}
	// A starter no slot takes (a roster the saved league's shape does not
	// fit) still starts: he ends the list in his position's slot.
	for _, id := range starters {
		if p, ok := byID[id]; ok && !starting[p] {
			starting[p] = true
			out.Starters = append(out.Starters, apitypes.BoxStarter{Slot: apitypes.BoxStarterSlot(cands[p].Position), Line: people[p].line})
		}
	}
	var bench []int
	for i := range people {
		if !starting[i] {
			bench = append(bench, i)
		}
	}
	sort.SliceStable(bench, func(i, j int) bool { return acrossBetter(&cands[bench[i]], &cands[bench[j]]) })
	for _, i := range bench {
		out.Bench = append(out.Bench, people[i].line)
	}
	return out
}
