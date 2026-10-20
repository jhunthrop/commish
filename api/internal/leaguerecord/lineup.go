package leaguerecord

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Positions the lineup fills: the four the register grades. Kickers and
// defenses are left out of both lineups, since the order the site ships
// in season ranks neither (research/nightly/published_board.py).
const (
	posQB = "QB"
	posRB = "RB"
	posWR = "WR"
	posTE = "TE"
)

var (
	flexPool      = map[string]bool{posRB: true, posWR: true, posTE: true}
	superFlexPool = map[string]bool{posQB: true, posRB: true, posWR: true, posTE: true}
)

// Candidate is one rostered player a lineup may start: his ESPN id and
// position, and the stance each lineup picks him by.
type Candidate struct {
	ID       string
	Position string
}

// Stance orders candidates for one lineup: better reports whether a goes
// before b. A stance must be a strict weak order with ties broken, so a
// lineup is the same however the roster arrives.
type Stance func(a, b Candidate) bool

// Lineup fills the league's starting slots from the candidates by the
// stance: each position's own slots first, then the flex from the backs,
// receivers and tight ends left, then the superflex from those and the
// quarterbacks left. A slot with no one left to fill it stays empty.
func Lineup(cands []Candidate, shape leaguesync.Shape, better Stance) []string {
	ordered := append([]Candidate(nil), cands...)
	sort.SliceStable(ordered, func(i, j int) bool { return better(ordered[i], ordered[j]) })
	taken := map[string]bool{}
	var out []string
	take := func(n int, fits func(Candidate) bool) {
		for _, c := range ordered {
			if n == 0 {
				return
			}
			if !taken[c.ID] && fits(c) {
				taken[c.ID] = true
				out = append(out, c.ID)
				n--
			}
		}
	}
	for _, slot := range []struct {
		position string
		n        int
	}{{posQB, shape.QB}, {posRB, shape.RB}, {posWR, shape.WR}, {posTE, shape.TE}} {
		take(slot.n, func(c Candidate) bool { return c.Position == slot.position })
	}
	take(shape.Flex, func(c Candidate) bool { return flexPool[c.Position] })
	take(shape.SuperFlex, func(c Candidate) bool { return superFlexPool[c.Position] })
	return out
}

// Slots is how many of the league's starting slots the lineups fill: the
// four positions, the flex and the superflex.
func Slots(shape leaguesync.Shape) int {
	return shape.QB + shape.RB + shape.WR + shape.TE + shape.Flex + shape.SuperFlex
}

// ByRank orders by a place in an order, lower first; a player the order
// does not list goes after every one it does; ties by id.
func ByRank(rank map[string]int) Stance {
	return func(a, b Candidate) bool {
		ra, oka := rank[a.ID]
		rb, okb := rank[b.ID]
		switch {
		case oka != okb:
			return oka
		case oka && ra != rb:
			return ra < rb
		}
		return a.ID < b.ID
	}
}

// ByPoints orders by projected points, more first; a player with none
// goes after every one with a figure; ties by id.
func ByPoints(points map[string]float64) Stance {
	return func(a, b Candidate) bool {
		pa, oka := points[a.ID]
		pb, okb := points[b.ID]
		switch {
		case oka != okb:
			return oka
		case oka && pa != pb:
			return pa > pb
		}
		return a.ID < b.ID
	}
}

// Scored is a lineup's points: each starter's, summed, a starter with no
// points for the week counting none.
func Scored(lineup []string, actual map[string]float64) float64 {
	sum := 0.0
	for _, id := range lineup {
		sum += actual[id]
	}
	return sum
}
