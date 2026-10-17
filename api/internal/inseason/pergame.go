package inseason

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// GamesLeft is each club's games from week first through LastWeek, the
// weeks the rest-of-season order covers: a bye is no game.
func GamesLeft(games []boards.TeamWeek, first int) map[string]int {
	out := map[string]int{}
	for _, g := range games {
		if g.Week >= first && g.Week <= LastWeek {
			out[g.Team]++
		}
	}
	return out
}

// RestOfSeasonPerGame is his rest-of-season points a game (Lane 64): the
// board's rest-of-season points over the games his club has left from the
// board's first week (left, from GamesLeft), to one decimal. The same
// figure the player page gives as a season total, and the order the
// screens rank by. Nil on the preseason number, on a run that does not
// say its first week, for a player with no projection, and for a club
// with no games left. A player who is out keeps it: it assumes he plays.
func RestOfSeasonPerGame(b boards.Board, p boards.Player, left map[string]int) *float64 {
	if !carriesPerGame(b) || p.Points == nil {
		return nil
	}
	games := left[p.Team]
	if games == 0 {
		return nil
	}
	v := roundTenth(*p.Points / float64(games))
	return &v
}

// PerGameBasis is the sentence a page's basis gains when its rows carry
// the figure.
func PerGameBasis(fromWeek int) string {
	return fmt.Sprintf("Points a game are our rest-of-season projection from week %d over the games his club has left, byes out.", fromWeek)
}

// carriesPerGame is whether the board's rows carry the figure: a
// rest-of-season order that says its first week.
func carriesPerGame(b boards.Board) bool {
	return b.Order == boards.OrderRestOfSeason && b.FromWeek >= 1
}

// withPerGame is a page's basis with the figure's sentence when any of
// the page's players carries it: a board that could carry it but whose
// rows do not (no game read from its first week) says nothing about it.
func withPerGame(b boards.Board, basis string, people ...[]person) string {
	if !perGameShown(b, people...) {
		return basis
	}
	return basis + " " + PerGameBasis(b.FromWeek)
}

// RestOfSeasonBasis is the Waivers screen's sentence for the figure, which
// it heads "Rest of season" (Lane 66f).
func RestOfSeasonBasis(fromWeek int) string {
	return fmt.Sprintf("Rest of season is his points a game on our rest-of-season projection from week %d, byes out.", fromWeek)
}

// withRestOfSeason is the Waivers screen's season line: the figure's
// sentence first when any of its players carries it, then basis.
func withRestOfSeason(b boards.Board, basis string, people ...[]person) string {
	if !perGameShown(b, people...) {
		return basis
	}
	return RestOfSeasonBasis(b.FromWeek) + " " + basis
}

// perGameShown is whether any of the page's players carries the figure.
func perGameShown(b boards.Board, people ...[]person) bool {
	if !carriesPerGame(b) {
		return false
	}
	for _, side := range people {
		for _, p := range side {
			if p.line.RestOfSeasonPerGame != nil {
				return true
			}
		}
	}
	return false
}
