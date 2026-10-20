package inseason

import "github.com/jhunthrop/commish/api/internal/draft"

// SeasonGames is the weeks the preseason number covers: the regular
// season's seventeen games.
const SeasonGames = 17

// LastWeek is the last week the published run's rest-of-season points
// cover, the last fantasy week (research.model.ros.outcomes'
// LAST_FANTASY_WEEK), and the order's for a read with no league
// (StandardHorizon).
const LastWeek = 17

// WeeksCovered is how many weeks the order's points over replacement
// cover: the season's on the preseason number; on the rest-of-season
// order, the first week it covers through the horizon's last, never fewer
// than one. A league with no week reads as the whole season.
func WeeksCovered(basis OrderBasis, week int, h Horizon) int {
	if basis != RestOfSeason || week < 1 {
		return SeasonGames
	}
	return max(1, h.Last-week+1)
}

// PerWeek is the order's points over replacement a week: averaged over
// the weeks it covers.
func PerWeek(total float64, weeks int) float64 { return total / float64(max(1, weeks)) }

// skill is a position the trade finder trades and a kicker or defense
// is never dropped for without a spare.
func skill(p draft.Position) bool {
	return p == draft.QB || p == draft.RB || p == draft.WR || p == draft.TE
}
