package inseason

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/season"
)

// placeNames are the board's team codes as a sentence names the club.
func placeNames() map[string]string {
	return map[string]string{
		"ARI": "Arizona", "ATL": "Atlanta", "BAL": "Baltimore", "BUF": "Buffalo", "CAR": "Carolina", "CHI": "Chicago",
		"CIN": "Cincinnati", "CLE": "Cleveland", "DAL": "Dallas", "DEN": "Denver", "DET": "Detroit", "GB": "Green Bay",
		"HOU": "Houston", "IND": "Indianapolis", "JAX": "Jacksonville", "KC": "Kansas City", "LAC": "the Chargers",
		"LAR": "the Rams", "LV": "Las Vegas", "MIA": "Miami", "MIN": "Minnesota", "NE": "New England", "NO": "New Orleans",
		"NYG": "the Giants", "NYJ": "the Jets", "PHI": "Philadelphia", "PIT": "Pittsburgh", "SEA": "Seattle",
		"SF": "San Francisco", "TB": "Tampa Bay", "TEN": "Tennessee", "WSH": "Washington",
	}
}

// placeOf is the club's name in a sentence, its code when unknown.
func placeOf(code string) string {
	if p, ok := placeNames()[code]; ok {
		return p
	}
	return code
}

// capitalized is a sentence's first word with a capital.
func capitalized(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// positionPlural names a position's players.
func positionPlural(p draft.Position) string {
	switch p {
	case draft.QB:
		return "quarterbacks"
	case draft.RB:
		return "running backs"
	case draft.WR:
		return "receivers"
	case draft.TE:
		return "tight ends"
	case draft.K:
		return "kickers"
	}
	return "defenses"
}

// ordinal is "1st", "2nd", "23rd".
func ordinal(n int) string {
	suffix := "th"
	switch {
	case n%100 >= 11 && n%100 <= 13:
	case n%10 == 1:
		suffix = "st"
	case n%10 == 2:
		suffix = "nd"
	case n%10 == 3:
		suffix = "rd"
	}
	return strconv.Itoa(n) + suffix
}

// points prints a figure to one decimal.
func points(v float64) string { return strconv.FormatFloat(roundTenth(v), 'f', 1, 64) }

// staleAfter is how old a stamp may be before it is named by its date.
const staleAfter = 6 * 24 * time.Hour

// stampWords is a stamp in the member's words, Eastern: "Thursday 4:10
// pm" within the week, "October 8" before it.
func stampWords(at, now time.Time) string {
	local := at.In(season.Eastern())
	if now.Sub(at) > staleAfter {
		return local.Format("January 2")
	}
	return local.Format("Monday 3:04 pm")
}

// rankWords is a position rank on the order: "RB14".
func rankWords(p draft.Position, rank int) string { return fmt.Sprintf("%s%d", p, rank) }

// lastName is the name a second mention uses: the last word, or the one
// before a suffix.
func lastName(full string) string {
	words := strings.Fields(full)
	if len(words) == 0 {
		return full
	}
	last := words[len(words)-1]
	switch strings.TrimSuffix(strings.ToLower(last), ".") {
	case "jr", "sr", "ii", "iii", "iv", "v":
		if len(words) > 1 {
			return words[len(words)-2]
		}
	}
	return last
}

// OrderBasis is which order ranks the players: the board's.
type OrderBasis = boards.Order

// The two orders (§3).
const (
	Preseason    = boards.OrderPreseason
	RestOfSeason = boards.OrderRestOfSeason
)

// orderWords names the order a rank is on.
func orderWords(b OrderBasis) string {
	if b == RestOfSeason {
		return "our rest-of-season order"
	}
	return "our preseason order"
}

// numberWords names the number a gain is on.
func numberWords(b OrderBasis) string {
	if b == RestOfSeason {
		return "our rest-of-season order"
	}
	return "our preseason number"
}

// shapeWords names the league a points over replacement is for: "a
// 12-team league with 1 QB, 2 RB, 3 WR, 1 TE and a flex".
func shapeWords(s apitypes.LeagueSettings) string {
	flex := "a flex"
	switch s.Lineup {
	case apitypes.LineupTwoFlex:
		flex = "two flex spots"
	case apitypes.LineupSuperflex:
		flex = "a flex and a superflex"
	}
	r := s.Roster
	return fmt.Sprintf("a %d-team league with %d QB, %d RB, %d WR, %d TE and %s", s.Teams, r.Qb, r.Rb, r.Wr, r.Te, flex)
}

// porWords is what points over replacement are and what "a week" is,
// so a week's figure never reads as a week's projection.
func porWords(b OrderBasis, weeks int) string {
	span := "the season on our preseason number"
	if b == RestOfSeason {
		span = "the rest of the season on our rest-of-season order"
	}
	return fmt.Sprintf("Points over replacement, and every gain in them, are points above what a free pickup at his "+
		"position gives you, a week: %s, averaged over its %s, not a projection of any one week.", span, weekCount(weeks))
}

// weekCount is "11 weeks", "one week".
func weekCount(n int) string {
	if n == 1 {
		return "one week"
	}
	return fmt.Sprintf("%d weeks", n)
}

// uncountedRules are the rules the season's stat lines hold no metric
// for (score.go), as a sentence names them.
func uncountedRules(r apitypes.ScoringRules) []struct {
	points float64
	words  string
} {
	return []struct {
		points float64
		words  string
	}{
		{r.PointsPerTwoPointConversion, "two-point conversions"}, {r.PointsPerFieldGoalMissed, "missed field goals"},
		{r.PointsPerExtraPointMissed, "missed extra points"}, {r.PointsPerReturnTouchdown, "return touchdowns"},
		{r.PointsPerDefensiveFumbleRecovery, "fumble recoveries"}, {r.PointsPerSafety, "safeties"},
	}
}

// uncountedWords says which of the league's rules points so far leave
// out, "" when the league scores none of them.
func uncountedWords(s apitypes.LeagueSettings) string {
	var named []string
	for _, u := range uncountedRules(rulesOf(s.Scoring)) {
		if u.points != 0 {
			named = append(named, u.words)
		}
	}
	if len(named) == 0 {
		return ""
	}
	list := named[0]
	if len(named) > 1 {
		list = strings.Join(named[:len(named)-1], ", ") + " and " + named[len(named)-1]
	}
	return "Points so far leave out your league's points for " + list + ": the stat lines we hold do not carry them."
}

// BasisNote is the rest of every page's basis, said once under the rows:
// the league the points over replacement are for, and the league's rules
// points so far leave out.
func BasisNote(s apitypes.LeagueSettings) string {
	shape := "Points over replacement are for " + shapeWords(s) + "."
	if u := uncountedWords(s); u != "" {
		return shape + " " + u
	}
	return shape
}

// LineupBasis is the start and sit page's honesty line (§4.4), on either
// order: neither projects a week, and the stamp dates the order.
func LineupBasis(b OrderBasis, weeks int) string {
	order := "our preseason number"
	if b == RestOfSeason {
		order = "our rest-of-season order"
	}
	return fmt.Sprintf("Ranked by %s and this week's designations. We do not project a week's points. %s",
		order, porWords(b, weeks))
}

// WaiversBasis is the waiver page's (§5.3).
func WaiversBasis(b OrderBasis, weeks int) string {
	return fmt.Sprintf("Ranked by the gain to your lineup on %s. A drop is the player it costs you least to lose. %s",
		numberWords(b), porWords(b, weeks))
}

// OnlyCloseCalls is a team's line when every trade found with it is a
// close call for them.
const OnlyCloseCalls = "Every trade we found with this team is a close call for them."

// TradesBasis is the trade finder's (§6.3).
func TradesBasis(b OrderBasis, weeks int) string {
	return fmt.Sprintf("Trades where both lineups gain on %s. The other team decides. %s", numberWords(b), porWords(b, weeks))
}
