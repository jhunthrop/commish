package inseason

import (
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// freeLevels is the waiver level at each position the league starts
// (Lane 269): the points over replacement of the best free agent there,
// from the free agents the Waivers screen reads (freeAgents). read is
// false when the league's free agents are not read (no roster placement,
// or a board with no players); a position missing from at, read or not,
// takes the last starter's level, 0.
type freeLevels struct {
	at   map[draft.Position]float64
	read bool
}

// of is the waiver level at the position.
func (l freeLevels) of(p draft.Position) float64 { return l.at[p] }

// whole is whether every skill position the league starts has a free
// agent's level: the rest-of-season line names the waiver level only then.
func (l freeLevels) whole(slots []Slot) bool {
	if !l.read {
		return false
	}
	for _, p := range []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE} {
		if _, ok := l.at[p]; startsAny(slots, p) && !ok {
			return false
		}
	}
	return true
}

// freeAgents is the board's players no roster in the league holds, at the
// positions the league starts, filtered to one position when asked: the
// Waivers screen's pool and the trades' waiver level read the same.
func (a *advisor) freeAgents(position draft.Position) []boards.Player {
	var out []boards.Player
	for _, p := range a.Board.Raw.Players {
		if _, held := a.HeldBy[p.ID]; held || !a.starts(p.Position) || (position != "" && p.Position != position) {
			continue
		}
		out = append(out, p)
	}
	return out
}

// levels is the league's freeLevels, read once per advisor.
func (a *advisor) levels() freeLevels {
	if a.free != nil {
		return *a.free
	}
	l := freeLevels{at: map[draft.Position]float64{}, read: a.HeldBy != nil && a.Board.Raw != nil && len(a.Board.Raw.Players) > 0}
	if l.read {
		for _, p := range a.freeAgents("") {
			v, ok := a.Board.Values[p.ID]
			if best, seen := l.at[p.Position]; ok && (!seen || v > best) {
				l.at[p.Position] = v
			}
		}
	}
	a.free = &l
	return l
}
