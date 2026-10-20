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

// countWords is a small count in words, "four", digits from ten on.
func countWords(n int) string {
	words := []string{"no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}
	if n >= 0 && n < len(words) {
		return words[n]
	}
	return strconv.Itoa(n)
}

// Uncounted is the league's rules a season's lines carry no metric for,
// so Avg and Last leave them out (Lane 66t): Note counts them for a
// screen's basis, Link is the words of its link to the league's Settings,
// where Rules lists them. Note and Link are empty, Rules too, when the
// league scores none of them or every one is counted.
type Uncounted struct {
	Note  string
	Link  string
	Rules []string
}

// UncountedOf is the league's uncounted rules. carried says whether any
// line this season carries a metric (Season.Carries); nil carries none.
func UncountedOf(s apitypes.LeagueSettings, carried func(string) bool) Uncounted {
	return uncountedOf(uncountedRules(s, carried), "your", true)
}

// uncountedOf counts rules in the one sentence every basis prints, whose
// rules they are ("your", or a reader's stand-in "the PPR"), and the
// link's words where there is a Settings to open (linked).
func uncountedOf(rules []string, whose string, linked bool) Uncounted {
	if len(rules) == 0 {
		return Uncounted{Rules: []string{}}
	}
	n := countWords(len(rules))
	out := Uncounted{Note: fmt.Sprintf("Avg and Last miss %s of %s rules our stats lack.", n, whose), Rules: rules}
	if linked {
		out.Link = "Which " + n
	}
	return out
}

// uncountedRules is the league's rules points so far leave out, in
// words: each one the league scores at a spot it starts and no line this
// season carries.
func uncountedRules(s apitypes.LeagueSettings, carried func(string) bool) []string {
	return uncountedWhere(s, carried, func(spot) bool { return true })
}

// uncountedWhere is the rules left out at the spots keep admits.
func uncountedWhere(s apitypes.LeagueSettings, carried func(string) bool, keep func(spot) bool) []string {
	var named []string
	for _, c := range countables(rulesOf(s.Scoring)) {
		if keep(c.spot) && c.points != 0 && c.starts(s) && !c.counted(carried) {
			named = append(named, c.words)
		}
	}
	return named
}

// tabSpots is the spot each week tab's rows score at (Lane 66w rereview
// N2): a kicker's Avg and Last leave out only kicking rules, a defense's
// only defense rules.
var tabSpots = map[draft.Position]spot{draft.K: kickerSpot, draft.DEF: defenseSpot}

// uncountedRulesAt is uncountedRules for one week tab's position.
func uncountedRulesAt(s apitypes.LeagueSettings, carried func(string) bool, position draft.Position) []string {
	want, ok := tabSpots[position]
	return uncountedWhere(s, carried, func(at spot) bool { return ok && at == want })
}

// gainWords is what a Gain is, said once on a screen (Lane 66t): whose
// lineup, a week, averaged over the weeks the order covers, named by
// number from the run's first week to the last (Lane 85 fix round 2, M-C),
// so the span stays true once a week is over and before the run rolls.
func gainWords(whose string, b OrderBasis, weeks int, h Horizon) string {
	if b != RestOfSeason {
		over := fmt.Sprintf("over the season's %s on our preseason number", weekCount(weeks))
		return fmt.Sprintf("Gain is %s change in points over replacement a week, %s.", whose, over)
	}
	return fmt.Sprintf("Gain is %s change in points over replacement a week, %s.", whose, weekSpan(weeks, h))
}

// weekSpan is the weeks the order covers by number, through the league's
// horizon (Lane 96): "weeks 6 to 17", "week 17", "weeks 7 to 18, the
// final over weeks 17 and 18".
func weekSpan(weeks int, h Horizon) string {
	from := h.Last - max(1, weeks) + 1
	if from == h.Last {
		return fmt.Sprintf("week %d", h.Last)
	}
	return fmt.Sprintf("weeks %d to %d%s", from, h.Last, h.finalWords(from))
}

// LineupBasis is the start and sit page's advice rule (§4.4, Lane 66e),
// over its rows: the lineup starts the highest Proj the rows show, after
// the week's designations and byes, and our order breaks ties (it stands
// in too where a row has none, which the Totals note counts).
func LineupBasis(b OrderBasis) string {
	order := "our order"
	if b != RestOfSeason {
		order = "our preseason number"
	}
	return fmt.Sprintf("We start the highest Proj at each slot after designations and byes, %s breaking ties.", order)
}

// ToPlayWords is a score bug's count while its game is under way (Lane
// 92, B02), never a zero: "3 to play" while any starter with a game is
// still to come, "2 playing" once none is and some are in play, empty once
// every one is done (the card is final). A starter on bye is neither.
func ToPlayWords(toPlay, playing int) string {
	switch {
	case toPlay > 0:
		return fmt.Sprintf("%d to play", toPlay)
	case playing > 0:
		return fmt.Sprintf("%d playing", playing)
	}
	return ""
}

// WeekDoneWords is the Lineup's sentence once every starter of the
// member's has played (Lane 85): nothing is left to set, so it stands
// where the changes and the verb would. It says the lineup, never the
// week (Lane 91): the score bug beside it says who is still to play.
func WeekDoneWords() string {
	return "Every starter of yours has played, so nothing is left to set."
}

// WaiversBasis is the waiver page's pickup rule (§5.3, Lane 66f): the
// week on the Proj the screen shows, the rest of the season on its Gain.
const WaiversBasis = "A pickup starts this week on Proj and keeps Gain at zero or better."

// WaiversBasisFor is the pickup rule for the week the page addresses: this
// week's, or once the page has turned to the week after (Lane 95) that
// week's by number.
func WaiversBasisFor(week int, turned bool) string {
	if !turned {
		return WaiversBasis
	}
	return fmt.Sprintf("A pickup starts in week %d on Proj and keeps Gain at zero or better.", week)
}

// SeasonOrderWords is the waiver page's rule once a pickup's game has
// kicked off (Lane 85 fix round 3): the adds go by the season Gain.
func SeasonOrderWords(week int) string {
	return fmt.Sprintf("Pickups go in Gain order once their week %d games kick off.", week)
}

// UnprojectedOrderWords is the waiver page's rule while the week it
// addresses has no published projection read (Lane 95): the adds go by the
// season Gain until it is in.
func UnprojectedOrderWords(week int) string {
	return fmt.Sprintf("Pickups go in Gain order until week %d's published projection is in.", week)
}

// WaiverSeasonBasis is what a waiver Gain is, the head the card and the
// drop panel print (Lane 66u).
func WaiverSeasonBasis(b OrderBasis, weeks int, h Horizon) string {
	return gainWords("your lineup's", b, weeks, h)
}

// OnlyCloseCalls is a team's line when every trade found with it is a
// close call for them.
const OnlyCloseCalls = "Every trade we found with this team is a close call for them."

// TradeCheckBasis is the trade builder's own line, under its scoreboard:
// what the scoreboard is (its own sentence says what to pick). The Trades
// screen's basis says what the figures are, so the builder says them no
// second time (Lane 66u, 66t).
const TradeCheckBasis = "The scoreboard is each lineup before and after the trade."

// TradesBasis is the trade finder's (§6.3): which trades it lists, yours
// first, who decides, and what a Gain is.
func TradesBasis(b OrderBasis, weeks int, h Horizon) string {
	return "Each team's best trade both lineups gain by, yours first. The other team decides. " + gainWords("a lineup's", b, weeks, h)
}

// formatNames is a scoring preset as a sentence names a league.
var formatNames = map[apitypes.ProjectionScoringFormat]string{
	apitypes.ProjectionScoringFormatPpr:      "PPR",
	apitypes.ProjectionScoringFormatHalfPpr:  "half-PPR",
	apitypes.ProjectionScoringFormatStandard: "standard",
}

// OrderLeague is the league the order screen's points over replacement
// are for: the member's own, or a stand-in for the reader with none.
func OrderLeague(own bool, s apitypes.LeagueSettings, format apitypes.ProjectionScoringFormat) string {
	if own {
		return "your league"
	}
	return fmt.Sprintf("a %d-team %s league", s.Teams, formatNames[format])
}

// RestFrom is the week a rest-of-season order starts from, and whether a
// game of it has kicked off (RestNow.Partial): then the order counts that
// week's games left.
type RestFrom struct {
	Week    int
	Partial bool
}

// restFromWords is the week the order counts from, said once: "from week
// 7", or while a game of it is played "from week 6's games left".
func restFromWords(r RestFrom) string {
	template := figurewords.Table.RestFrom
	if r.Partial {
		template = figurewords.Table.RestFromPartial
	}
	return strings.ReplaceAll(template, figurewords.WeekSlot, strconv.Itoa(r.Week))
}

// OrderScreenBasis is the Rest of season and Players screens' line
// (Lane 66j, 66t): what the order ranks by, from which week's games
// (Lane 86), and the league its points over replacement are for, said once.
// The rest of season runs through the league's horizon (Lane 96), its
// two-week final named.
func OrderScreenBasis(b OrderBasis, from RestFrom, league string, h Horizon) string {
	if b != RestOfSeason || from.Week < 1 {
		return fmt.Sprintf("Our preseason order: All ranks by Over repl., his season less a free pickup's in %s.", league)
	}
	return fmt.Sprintf("Our rest-of-season order %s. A position ranks by %s through week %d%s, byes out, "+
		"All by Over repl., his points less a free pickup's in %s.", restFromWords(from), figurewords.Table.Projected, h.Last,
		h.finalWords(from.Week), league)
}
