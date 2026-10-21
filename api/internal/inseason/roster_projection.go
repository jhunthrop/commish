package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// rosterProjection is the Proj of a side the platform lists no starters
// for (every FFPC side but the member's) where the league read carries its
// roster (FFPC's rosters page): our best lineup from that roster this
// week, its starters' week projections summed as printed (Lane 127, B105).
// ok is false for a side that lists starters and for one with no roster
// read, whose Proj stays none.
func (a *advisor) rosterProjection(s *leaguesync.Side) (*float64, bool) {
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
	return printedLines(bestLineup(a.config, people)), true
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
