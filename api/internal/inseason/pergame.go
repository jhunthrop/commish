package inseason

import (
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/figurewords"
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

// carriesPerGame is whether the board's rows carry the figure: a
// rest-of-season order that says its first week.
func carriesPerGame(b boards.Board) bool {
	return b.Order == boards.OrderRestOfSeason && b.FromWeek >= 1
}

// perGameSaid is the figure's sentence when any of the page's players
// carries it, "" else: a board that could carry it but whose rows do not
// (no game read from its first week) says nothing about it.
func perGameSaid(b boards.Board, people ...[]person) string {
	if !perGameShown(b, people...) {
		return ""
	}
	return PerGameBasis()
}

// withPerGame is a basis with the figure's sentence after it when any of
// the page's players carries it.
func withPerGame(b boards.Board, basis string, people ...[]person) string {
	if said := perGameSaid(b, people...); said != "" {
		return basis + " " + said
	}
	return basis
}

// PerGameBasis is the sentence for the figure, headed by its one word on
// every screen (the figure words' perGame, Lane 66s, 66t): one unit, said
// in one way.
func PerGameBasis() string {
	return figurewords.Table.PerGame + " is that order's points a game."
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
