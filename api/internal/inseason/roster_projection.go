package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// rosterLineup is our best lineup this week from the roster of a side the
// platform lists no starters for (every FFPC side but the member's), where
// the league read carries that roster (FFPC's rosters page; Lane 127,
// B105). ok is false for a side that lists starters and for one with no
// roster read: its Proj and Proj final stay none.
func (a *advisor) rosterLineup(s *leaguesync.Side) ([]apitypes.PlayerLine, bool) {
	if s == nil || len(s.Starters) > 0 {
		return nil, false
	}
	t, ok := a.Snap.TeamByRoster(s.RosterID)
	if !ok {
		return nil, false
	}
	people := a.active(t)
	if len(people) == 0 {
		return nil, false
	}
	return bestLineup(a.config, people), true
}

// bestLineup is the roster's best lineup this week under the league's
// slots by the lineup rule (the engine's week fill, as the Lineup and the
// waiver search fill: each position's own slots, then the shared ones, by
// the week's keys), from every player who can play this week. A player
// whose game has kicked off is placed like any other: no platform lineup
// holds him anywhere to keep. A slot nobody eligible fills is left empty.
func bestLineup(config []draft.SlotConfig, people []person) []apitypes.PlayerLine {
	pool := make([]*Candidate, len(people))
	taken := make([]bool, len(people))
	for i := range people {
		pool[i] = &people[i].cand
		// A bye or a designation that keeps him out never starts (Lane 66e).
		taken[i] = people[i].cand.Tier != Available
	}
	f := newFiller(Slots(config), SeasonGames)
	f.week = true
	var out []apitypes.PlayerLine
	for _, p := range f.fill(f.open, pool, taken) {
		if p >= 0 {
			out = append(out, people[p].line)
		}
	}
	return out
}

// rosterProjectedFinal is the projected final of a side whose Proj is our
// best lineup from its roster (Lane 127 fix round 1): the platform's team
// points so far plus the week projection, as printed, of each player of
// that lineup still to play; one in play or final adds nothing (his part
// is in the points the platform gives), one out counts nothing. Nil
// before the game has kicked off (the Proj is then the figure), with the
// score unread, or while a player still to play has no Proj.
func rosterProjectedFinal(points *float64, lineup []apitypes.PlayerLine, started bool) *float64 {
	if points == nil || !started {
		return nil
	}
	sum := *points
	for _, l := range lineup {
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
