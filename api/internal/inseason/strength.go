package inseason

import "github.com/jhunthrop/commish/api/internal/draft"

// SeasonGames turns a season's points over replacement into a week's:
// the regular season's seventeen games.
const SeasonGames = 17

// PerWeek is a season's points over replacement a week.
func PerWeek(season float64) float64 { return season / SeasonGames }

// skill is a position the trade finder trades and a kicker or defense
// is never dropped for without a spare.
func skill(p draft.Position) bool {
	return p == draft.QB || p == draft.RB || p == draft.WR || p == draft.TE
}
