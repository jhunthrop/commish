package inseason

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/figurewords"
	"github.com/jhunthrop/commish/api/internal/scoring"
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
	return fmt.Sprintf("a %d-team league with %s", s.Teams, startersWords(s, true))
}

// startersWords is a league's starting spots: "1 QB, 2 RB, 3 WR, 1 TE and two
// flex spots", or "... and two flex" in the order screen's few words
// (flexSpots false).
func startersWords(s apitypes.LeagueSettings, flexSpots bool) string {
	flex := "a flex"
	switch s.Lineup {
	case apitypes.LineupTwoFlex:
		flex = "two flex"
		if flexSpots {
			flex += " spots"
		}
	case apitypes.LineupSuperflex:
		flex = "a flex and a superflex"
	}
	r := s.Roster
	return fmt.Sprintf("%d QB, %d RB, %d WR, %d TE and %s", r.Qb, r.Rb, r.Wr, r.Te, flex)
}

// porWords is what a trade's Gain is (the head Trades prints, Lane 66u)
// and what "a week" is, so a week's figure never reads as a week's
// projection.
func porWords(b OrderBasis, weeks int) string {
	span := "the season on our preseason number"
	if b == RestOfSeason {
		span = "the rest of the season on our rest-of-season order"
	}
	return fmt.Sprintf("Gain is the change in a lineup's points over replacement a week, points above what a free pickup at "+
		"each position gives you: %s, averaged over its %s, not a projection of any one week.", span, weekCount(weeks))
}

// slotNames is a slot type as a lineup row labels it (the web's
// slotLabels).
var slotNames = map[draft.SlotType]string{draft.SlotFlex: "Flex", draft.SlotSuperflex: "Superflex"}

// SlotLabel is slots[i] as a lineup row labels it, numbered where the
// lineup has more than one alike: "QB", "RB2", "Flex", "Flex 2".
func SlotLabel(slots []Slot, i int) string {
	s := slots[i]
	name, long := slotNames[s.Type]
	if !long {
		name = string(s.Type)
	}
	alike := 0
	for _, o := range slots {
		if o.Type == s.Type {
			alike++
		}
	}
	switch {
	case alike < 2:
		return name
	case long:
		return fmt.Sprintf("%s %d", name, s.Index+1)
	}
	return fmt.Sprintf("%s%d", name, s.Index+1)
}

// weekCount is "11 weeks", "one week".
func weekCount(n int) string {
	if n == 1 {
		return "one week"
	}
	return fmt.Sprintf("%d weeks", n)
}

// spot is the starting spot a rule scores, so the basis names it only
// where the league starts the position: anyone, a kicker or a defense.
type spot int

const (
	anySpot spot = iota
	kickerSpot
	defenseSpot
)

// countable is a rule a stat line may carry no metric for (score.go):
// the league's points for it as the basis weighs them, its words, the
// spot it scores and the metrics that count it.
type countable struct {
	points  float64
	words   string
	spot    spot
	metrics []string
}

// countables is the league's rules points so far count only where a
// season's line carries their metric.
func countables(r apitypes.ScoringRules) []countable {
	m := scoring.ToMap(r)
	tierPoints := func(tiers []scoring.Tier) float64 {
		most := 0.0
		for _, t := range tiers {
			most = math.Max(most, math.Abs(m[t.Key]))
		}
		return most
	}
	longer := math.Abs(r.PointsPerFieldGoal4049-r.PointsPerFieldGoal) + math.Abs(r.PointsPerFieldGoal50Plus-r.PointsPerFieldGoal)
	return []countable{
		{r.PointsPerTwoPointConversion, "two-point conversions", anySpot, []string{"two_point_conversions"}},
		{longer, "field goals of 40 yards or more", kickerSpot, []string{metricFieldGoals40To49, metricFieldGoals50To59, metricFieldGoals60Up}},
		{r.PointsPerFieldGoalMissed, "missed field goals", kickerSpot, []string{"field_goals_missed"}},
		{r.PointsPerExtraPointMissed, "missed extra points", kickerSpot, []string{"extra_points_missed"}},
		{r.PointsPerReturnTouchdown, "a player's kick and punt return touchdowns", anySpot, []string{"kick_return_touchdowns", "punt_return_touchdowns"}},
		{r.PointsPerDefensiveFumbleRecovery, "fumble recoveries", defenseSpot, []string{"defensive_fumbles_recovered"}},
		{r.PointsPerSafety, "safeties", defenseSpot, []string{"safeties"}},
		{tierPoints(scoring.PointsAllowedTiers()), "a defense's points allowed", defenseSpot, []string{metricPointsAllowed}},
		{tierPoints(scoring.YardsAllowedTiers()), "a defense's yards allowed", defenseSpot, []string{metricYardsAllowed}},
	}
}

// starts reports whether the league starts a rule's spot.
func (c countable) starts(s apitypes.LeagueSettings) bool {
	switch c.spot {
	case kickerSpot:
		return s.Roster.K > 0
	case defenseSpot:
		return s.Roster.Dst > 0
	}
	return true
}

// counted reports whether a season's line carries one of the rule's
// metrics; nil carries none.
func (c countable) counted(carried func(string) bool) bool {
	if carried == nil {
		return false
	}
	for _, metric := range c.metrics {
		if carried(metric) {
			return true
		}
	}
	return false
}

// uncountedWords says which of the league's rules points so far leave
// out, "" when the league scores none of them or every one is counted.
func uncountedWords(s apitypes.LeagueSettings, carried func(string) bool) string {
	var named []string
	for _, c := range countables(rulesOf(s.Scoring)) {
		if c.points != 0 && c.starts(s) && !c.counted(carried) {
			named = append(named, c.words)
		}
	}
	if len(named) == 0 {
		return ""
	}
	list := named[0]
	if len(named) > 1 {
		list = strings.Join(named[:len(named)-1], ", ") + " and " + named[len(named)-1]
	}
	return "Points so far leave out " + list + ", which our stats lack."
}

// BasisNote is the rest of every page's basis, said once under the rows:
// the league the points over replacement are for, and the league's rules
// points so far leave out. carried says whether any line this season
// carries a metric (Season.Carries).
func BasisNote(s apitypes.LeagueSettings, carried func(string) bool) string {
	shape := "Points over replacement are for " + shapeWords(s) + "."
	if u := uncountedWords(s, carried); u != "" {
		return shape + " " + u
	}
	return shape
}

// LineupBasis is the start and sit page's honesty line (§4.4), the
// advice rule the coordinator ruled (Lane 66e): the page never argues with
// its own numbers, so the lineup starts the highest Proj the rows show,
// and our order only breaks ties and stands in where a row has none.
func LineupBasis(b OrderBasis) string {
	order := "Our preseason number"
	if b == RestOfSeason {
		order = "Our rest-of-season order"
	}
	return fmt.Sprintf("We start the highest Proj at each slot, after this week's designations and byes. "+
		"A player who cannot play this week never starts. %s breaks ties and stands in where a player has no Proj.", order)
}

// LineupNote is the start and sit page's note under its rows: the league's
// rules its points so far leave out, empty when they leave out none.
func LineupNote(s apitypes.LeagueSettings, carried func(string) bool) string {
	return uncountedWords(s, carried)
}

// WaiversBasis is the waiver page's first basis line (§5.3), the pickup
// rule the strip follows (Lane 66f): the week on the Proj the screen
// shows, as the Lineup screen's advice, and the rest of the season on our
// number.
func WaiversBasis(b OrderBasis) string {
	return fmt.Sprintf("A pickup starts for you this week on the Proj shown and its Gain is not below zero on %s. "+
		"Its drop is the one you lose least by.", numberWords(b))
}

// WaiverSeasonBasis is what a waiver Gain is, the head the card and the
// drop panel print (Lane 66u).
func WaiverSeasonBasis(b OrderBasis, weeks int) string {
	return fmt.Sprintf("Gain is the change in your lineup's points over replacement a week on %s, averaged over its %s.", numberWords(b), weekCount(weeks))
}

// OnlyCloseCalls is a team's line when every trade found with it is a
// close call for them.
const OnlyCloseCalls = "Every trade we found with this team is a close call for them."

// TradeCheckBasis is the trade builder's: the finder's line for a trade
// the member built, which either lineup may gain or lose by. The builder
// opens on the Trades screen, whose basis says what Gain and Rest of
// season are, so this line points there and says them no second time
// (review 66u, finding 4).
func TradeCheckBasis(b OrderBasis) string {
	return fmt.Sprintf("What each lineup gains or loses on %s. The other team decides. Gain and Rest of season are as the Trades basis says.",
		numberWords(b))
}

// TradesBasis is the trade finder's (§6.3): which trades it lists, on the
// board's own order, and the order it lists each team's in (orderTrades):
// those the other team gains at least CloseCall a week from first, best
// for you first, then the close calls for them.
func TradesBasis(b OrderBasis, weeks int) string {
	return fmt.Sprintf("Trades where both lineups gain on %s. Each team's best trade, yours first, among those they gain at least %.1f a week from, "+
		"then the close calls for them. The other team decides. %s", numberWords(b), CloseCall, porWords(b, weeks))
}

// OrderScreenBasis is the Rest of season and Players screens' line
// (Lane 66j): what the order ranks by, what its two figures are and the
// league its points over replacement are for, said once (Lane 66q: the
// screen's note is then the rules points so far leave out, LineupNote, so
// the whole basis fits eight phone lines).
func OrderScreenBasis(b OrderBasis, fromWeek int, s apitypes.LeagueSettings) string {
	if b != RestOfSeason || fromWeek < 1 {
		return fmt.Sprintf("Our preseason order: All ranks by Over repl., his season less a free pickup's, for %s.", teamsWords(s))
	}
	return fmt.Sprintf("Our rest-of-season order from week %d. A position ranks by %s through week %d, byes out, "+
		"All by Over repl., his points less a free pickup's, for %s.", fromWeek, figurewords.Table.Projected, LastWeek, teamsWords(s))
}

// teamsWords is shapeWords in the order screen's few words: "12 teams
// with 1 QB, 2 RB, 3 WR, 1 TE and two flex".
func teamsWords(s apitypes.LeagueSettings) string {
	return fmt.Sprintf("%d teams with %s", s.Teams, startersWords(s, false))
}
