package inseason

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// rosterBest is our best lineup this week from a side's roster (bestLineup)
// and whether it passed over a player with no Proj to make it: one who can
// play and would start in it were he counted (Lane 137, B107), so the
// screens say the lineup is from the players with a Proj.
type rosterBest struct {
	lines   []apitypes.PlayerLine
	skipped bool
}

// rosterLineup is our best lineup this week from the roster of a side the
// platform lists no starters for (every FFPC side but the member's), where
// the league read carries that roster (FFPC's rosters page; Lane 127,
// B105). ok is false for a side that lists starters and for one with no
// roster read: its Proj and Proj final stay none.
func (a *advisor) rosterLineup(s *leaguesync.Side) (rosterBest, bool) {
	if s == nil || len(s.Starters) > 0 {
		return rosterBest{}, false
	}
	t, ok := a.Snap.TeamByRoster(s.RosterID)
	if !ok {
		return rosterBest{}, false
	}
	people := a.active(t)
	if len(people) == 0 {
		return rosterBest{}, false
	}
	return bestLineup(a.config, people), true
}

// rosterProjection is the Proj every screen draws for a side whose Proj is
// our best lineup from its roster, the scoreboard's and the Matchup's
// alike (Lane 137, B107: one figure per side across screens): the lineup's
// printed Proj summed, from the slots it fills, none where it fills none;
// with the flag that says so and, where it passed over a player with no
// Proj, the flag that says that.
func rosterProjection(best rosterBest) (projection *float64, bestLineup, skipped *bool) {
	yes := true
	if best.skipped {
		skipped = &yes
	}
	return printedLines(best.lines), &yes, skipped
}

// bestLineup is the roster's best lineup this week under the league's
// slots by the lineup rule (the engine's week fill, as the Lineup and the
// waiver search fill: each position's own slots, then the shared ones, by
// the week's keys), from every player who can play this week and has a
// Proj. A player whose game has kicked off is placed like any other: no
// platform lineup holds him anywhere to keep. A slot nobody with a Proj
// can fill is left empty, and the lineup is still the slots it fills
// (Lane 137, B107); skipped says a player with no Proj who can play was
// passed over for it.
func bestLineup(config []draft.SlotConfig, people []person) rosterBest {
	pool := make([]*Candidate, len(people))
	for i := range people {
		pool[i] = &people[i].cand
	}
	// A bye or a designation that keeps him out never starts (Lane 66e), and
	// a player we hold no Proj for is no part of a lineup we project (Lane
	// 127 fix round 3): he would add nothing to its Proj and void its Proj
	// final.
	playing := func(c *Candidate) bool { return c.Tier == Available }
	projected := func(c *Candidate) bool { return playing(c) && c.HasProj }
	var out rosterBest
	for _, p := range slotFill(config, pool, projected, true) {
		out.lines = append(out.lines, people[p].line)
	}
	// Passed over: a player with no Proj who can play starts in the fill
	// that counts him, by the week's order (a slot the lineup leaves empty)
	// or by the rest of season's (a better player than the one his slot
	// took).
	for _, week := range []bool{true, false} {
		for _, p := range slotFill(config, pool, playing, week) {
			out.skipped = out.skipped || !pool[p].HasProj
		}
	}
	return out
}

// slotFill is the engine's fill of the league's slots from the players of
// pool that may start, by the week's order or the rest of season's, their
// pool indexes, an empty slot left out.
func slotFill(config []draft.SlotConfig, pool []*Candidate, may func(*Candidate) bool, week bool) []int {
	taken := make([]bool, len(pool))
	for i, c := range pool {
		taken[i] = !may(c)
	}
	f := newFiller(Slots(config), SeasonGames)
	f.week = week
	var out []int
	for _, p := range f.fill(f.open, pool, taken) {
		if p >= 0 {
			out = append(out, p)
		}
	}
	return out
}

// gameLength is how long a game is taken to last for the pace of a player
// in play (Lane 127 fix round 3): 3 h 15 m.
const gameLength = 3*time.Hour + 15*time.Minute

// rosterProjectedFinal is the projected final of a side whose Proj is our
// best lineup from its roster (Lane 127 fix rounds 1 to 3): the platform's
// team points so far plus, over that lineup, the Proj of each player still
// to play and, for each in play, the rest of his Proj (inPlayAt); one
// final or out adds nothing. Nil before the game has kicked off (the Proj
// is then the figure), with the score unread, or while a player still to
// play has no Proj. An empty lineup leaves the points.
func rosterProjectedFinal(points *float64, lineup []apitypes.PlayerLine, started bool, now time.Time) *float64 {
	if points == nil || !started {
		return nil
	}
	return pointsPlusLeft(*points, lineup, func(l apitypes.PlayerLine) float64 { return inPlayAt(l, now) })
}

// pacedFinal is whether a best lineup's projected final counts a player in
// play at his projection's pace (inPlayAt with no points read and some of
// his game left): the screens then say so (Lane 127 fix round 3). Nil when
// none is, and with no projected final.
func pacedFinal(final *float64, lineup []apitypes.PlayerLine, now time.Time) *bool {
	if final == nil {
		return nil
	}
	for _, l := range lineup {
		f := l.Facts
		if f.Bye || f.GameState == nil || *f.GameState != apitypes.GameStateKickedOff || sitsOut(f) || f.PointsThisWeek != nil {
			continue
		}
		if inPlayAt(l, now) > 0 {
			paced := true
			return &paced
		}
	}
	return nil
}

// inPlayAt is what a best lineup's player in play is still projected to
// add: where the read gives his points, Lane 92's max(0, Proj - Pts)
// (restOfProjection); where it does not (FFPC), his Proj at its pace, the
// Proj times the share of his game still to play from its kickoff to now
// over gameLength, the share held between 0 and 1, never the whole Proj,
// which would count his points so far twice (Lane 127 fix round 3).
func inPlayAt(l apitypes.PlayerLine, now time.Time) float64 {
	if l.Facts.PointsThisWeek != nil {
		return restOfProjection(l)
	}
	if l.WeekProjection == nil || l.Facts.Kickoff == nil {
		return 0
	}
	left := 1 - float64(now.Sub(*l.Facts.Kickoff))/float64(gameLength)
	return roundTenth(*l.WeekProjection) * min(1, max(0, left))
}
