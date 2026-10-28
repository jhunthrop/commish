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
// the league's points for it as the basis weighs them, its words on the
// league's Settings list, its name in a basis sentence (Lane 111, B33:
// "Our stats omit two-point and safety."), the spot it scores and the
// metrics that count it.
type countable struct {
	points  float64
	words   string
	name    string
	spot    spot
	metrics []string
}

// The basis names of the two missed kicks, said as one where both are
// left out, so the sentence keeps to Lane 108's phone budget.
const (
	missedFieldGoalName = "missed field goal"
	missedExtraName     = "missed extra point"
	missedKickName      = "missed kick"
)

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
		{r.PointsPerTwoPointConversion, "two-point conversions", "two-point", anySpot, []string{"two_point_conversions"}},
		{longer, "field goals of 40 yards or more", "long field goal", kickerSpot, []string{metricFieldGoals40To49, metricFieldGoals50To59, metricFieldGoals60Up}},
		{r.PointsPerFieldGoalMissed, "missed field goals", missedFieldGoalName, kickerSpot, []string{"field_goals_missed"}},
		{r.PointsPerExtraPointMissed, "missed extra points", missedExtraName, kickerSpot, []string{"extra_points_missed"}},
		{r.PointsPerReturnTouchdown, "a player's kick and punt return touchdowns", "return touchdown", anySpot, []string{"kick_return_touchdowns", "punt_return_touchdowns"}},
		{r.PointsPerDefensiveFumbleRecovery, "fumble recoveries", "fumble recovery", defenseSpot, []string{"defensive_fumbles_recovered"}},
		{r.PointsPerSafety, "safeties", "safety", defenseSpot, []string{"safeties"}},
		{tierPoints(scoring.PointsAllowedTiers()), "a defense's points allowed", "points allowed", defenseSpot, []string{metricPointsAllowed}},
		{tierPoints(scoring.YardsAllowedTiers()), "a defense's yards allowed", "yards allowed", defenseSpot, []string{metricYardsAllowed}},
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
// so Avg and Last leave them out (Lane 66t): Note names them for a
// screen's basis (Lane 111, B33), Rules lists them in the league's
// Settings words. Note is empty, Rules too, when the league scores none
// of them or every one is counted.
type Uncounted struct {
	Note  string
	Rules []string
	// Names is the rules as Note names them, at most four then "and two
	// more rules" (Lane 115, B92; Lane 121, B97), for the web to say in its own frame: "Avg
	// and Last are our stats, which omit ..." where no row counts the
	// platform's points.
	Names string
}

// namedRulesMost is the most rules a basis names before it counts the rest
// ("and two more rules"), so the sentence keeps to a phone's eight lines however
// many rules a league scores (Lane 115, B92).
const namedRulesMost = 4

// UncountedOf is the league's uncounted rules. carried says whether any
// line this season carries a metric (Season.Carries); nil carries none.
func UncountedOf(s apitypes.LeagueSettings, carried func(string) bool) Uncounted {
	return uncountedOf(uncountedRules(s, carried))
}

// uncountedOf names the rules in the one sentence every basis prints, the
// stats' sentence (Lane 111 fix round 1: true beside the platform's points,
// which score every rule), as short as a phone's eight lines need: "Our
// stats omit two-point, missed kick, fumble recovery and safety." for the
// fixture's five.
func uncountedOf(left []countable) Uncounted {
	if len(left) == 0 {
		return Uncounted{Rules: []string{}}
	}
	rules := make([]string, 0, len(left))
	for _, c := range left {
		rules = append(rules, c.words)
	}
	names := andList(cappedNames(basisNames(left)))
	return Uncounted{Note: fmt.Sprintf("Our stats omit %s.", names), Rules: rules, Names: names}
}

// basisNames is the rules' names as a basis says them, the two missed
// kicks said once, as a missed kick, where both are left out.
func basisNames(left []countable) []string {
	kicks := 0
	for _, c := range left {
		if missedKick(c) {
			kicks++
		}
	}
	names := make([]string, 0, len(left))
	for _, c := range left {
		switch {
		case kicks < 2 || !missedKick(c):
			names = append(names, c.name)
		case c.name == missedFieldGoalName:
			names = append(names, missedKickName)
		}
	}
	return names
}

// cappedNames is the first namedRulesMost names and the rest counted,
// "two more rules" ("one more rule"), where there are more: the word
// rules closes the sentence, which points nowhere else (Lane 121, B97;
// the Settings anchor went in Lane 111).
func cappedNames(names []string) []string {
	if len(names) <= namedRulesMost {
		return names
	}
	kept := append([]string{}, names[:namedRulesMost]...)
	return append(kept, moreRules(len(names)-namedRulesMost))
}

// moreRules is the rules past the named ones, in words: "one more rule",
// "two more rules".
func moreRules(n int) string {
	if n == 1 {
		return "one more rule"
	}
	return countWords(n) + " more rules"
}

// missedKick reports whether the rule is a missed field goal or extra point.
func missedKick(c countable) bool {
	return c.name == missedFieldGoalName || c.name == missedExtraName
}

// andList is names joined as a sentence says them: "a", "a and b",
// "a, b and c".
func andList(names []string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// uncountedRules is the league's rules points so far leave out: each one
// the league scores at a spot it starts and no line this season carries.
func uncountedRules(s apitypes.LeagueSettings, carried func(string) bool) []countable {
	return uncountedWhere(s, carried, func(spot) bool { return true })
}

// uncountedWhere is the rules left out at the spots keep admits.
func uncountedWhere(s apitypes.LeagueSettings, carried func(string) bool, keep func(spot) bool) []countable {
	var left []countable
	for _, c := range countables(rulesOf(s.Scoring)) {
		if keep(c.spot) && c.points != 0 && c.starts(s) && !c.counted(carried) {
			left = append(left, c)
		}
	}
	return left
}

// tabSpots is the spot each week tab's rows score at (Lane 66w rereview
// N2): a kicker's Avg and Last leave out only kicking rules, a defense's
// only defense rules.
var tabSpots = map[draft.Position]spot{draft.K: kickerSpot, draft.DEF: defenseSpot}

// uncountedRulesAt is uncountedRules for one week tab's position.
func uncountedRulesAt(s apitypes.LeagueSettings, carried func(string) bool, position draft.Position) []countable {
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
	from := h.Last - max(1, weeks) + 1
	return fmt.Sprintf("Gain is %s change in points over replacement a week, %s.%s", whose, weekSpan(weeks, h), h.rateWords(from))
}

// weekSpan is the weeks the order covers by number, through the league's
// horizon (Lane 96): "weeks 6 to 17", "week 17", "weeks 7 to 18, the
// championship over weeks 17 and 18".
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
// member's with a game has kicked off (Lane 85, Lane 109): nothing is
// left to set, so it stands where the changes and the verb would. "has
// kicked off" while any of them is still in play, "has played" once
// every one is final. It says the lineup, never the week (Lane 91): the
// score bug beside it says who is still to play.
func WeekDoneWords(everyFinal bool) string {
	if everyFinal {
		return "Every starter of yours has played, so nothing is left to set."
	}
	return "Every starter of yours has kicked off, so nothing is left to set."
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
// first, who decides, and the keep rule (Lane 103, B43) in one sentence.
// What a Gain is sits under the heads (TradeGainBasis); a span past the
// run's last week says its rate here once.
func TradesBasis(b OrderBasis, weeks int, h Horizon) string {
	listed := "Each team's best trade both lineups gain by, yours first. The other team decides. " + keptWords
	if b != RestOfSeason {
		return listed
	}
	return listed + h.rateWords(h.Last-max(1, weeks)+1)
}

// keptWords is Lane 103's rule (proposable) in one sentence.
var keptWords = fmt.Sprintf("A player we rank first at his position goes only for %.1f a week or more, or to fill a spot.", KeepGain)

// TradeGainBasis is the line under the finder's Gain head (Lane 103,
// B42): whose points, and the weeks they are a week over, "points over
// replacement in each lineup, weeks 7 to 17".
func TradeGainBasis(b OrderBasis, weeks int, h Horizon) string {
	return "points over replacement in each lineup, " + tradeWeeks(b, weeks, h)
}

// tradeWeeks is the weeks a trade's figures cover, as the trade lines
// say them: "weeks 7 to 17", or the season's on the preseason number.
func tradeWeeks(b OrderBasis, weeks int, h Horizon) string {
	if b != RestOfSeason {
		return fmt.Sprintf("over the season's %s on our preseason number", weekCount(weeks))
	}
	return weekSpan(weeks, h)
}

// The rest-of-season rule (Lane 269) as each answer says it: the finder
// lists only trades both sides take; the builder answers each side.
const (
	finderRest = "We list a trade only when neither side falls by more than %s."
	checkRest  = "A side takes a trade that costs it %s or less."
)

// The level the rest-of-season figures are over: the best free agent a
// side could start at each position, or, with no read of the league's
// free agents, the last starter league-wide.
const (
	overFreeAgent   = "the best free agent at their position"
	overLastStarter = "the last starter at their position league-wide, as we have no read of the league's free agents"
)

// RestOfSeasonBasis is the line for a trade's rest-of-season figures
// (Lane 269): what they count over which level, the weeks, and the rule,
// the finder's (finder) or the builder's. read is whether the league's
// free agents are read at all; lacking is each position with no free
// agent a side could start, named in its own sentence where the last
// starter's level stands in (fix round 2, LOW-A): "Rest of season is what
// the players a side gets score over the best free agent at their
// position, less the same for those it gives and drops, weeks 9 to 17. At
// QB it is over the last starter league-wide, as the league has no free
// quarterback. We list a trade only when neither side falls by more than
// 9.0."
func RestOfSeasonBasis(b OrderBasis, weeks int, h Horizon, finder, read bool, lacking []draft.Position) string {
	rule, level := checkRest, overLastStarter
	if finder {
		rule = finderRest
	}
	if read {
		level = overFreeAgent
	}
	out := "Rest of season is what the players a side gets score over " + level +
		", less the same for those it gives and drops, " + tradeWeeks(b, weeks, h) + ". "
	if read && len(lacking) > 0 {
		out += lackingWords(lacking) + " "
	}
	return out + fmt.Sprintf(rule, points(GiveUp(weeks)))
}

// lackingWords is the sentence for the positions with no free agent a
// side could start: "At QB and TE it is over the last starter
// league-wide, as the league has no free quarterback or tight end."
func lackingWords(lacking []draft.Position) string {
	labels, nouns := make([]string, len(lacking)), make([]string, len(lacking))
	for i, p := range lacking {
		labels[i], nouns[i] = string(p), positionSingular(p)
	}
	none := strings.Join(nouns, " or ")
	if len(nouns) > 2 {
		none = strings.Join(nouns[:len(nouns)-1], ", ") + " or " + nouns[len(nouns)-1]
	}
	return fmt.Sprintf("At %s it is over the last starter league-wide, as the league has no free %s.", andList(labels), none)
}

// positionSingular names one of a skill position's players.
func positionSingular(p draft.Position) string {
	switch p {
	case draft.QB:
		return "quarterback"
	case draft.RB:
		return "running back"
	case draft.WR:
		return "receiver"
	}
	return "tight end"
}

// TradeNeedWords is the need a trade fills (Lane 103, B43): the empty
// spot by its label, and the player it sends out who sits on bye that
// week when there is one ("Fills your empty WR2 while Gibbs sits on
// bye."), else the week ("Fills your empty FLEX this week.", "... in week
// 7." once the page has turned to it).
func TradeNeedWords(slot string, onBye *Line, week int, turned bool) string {
	switch {
	case onBye != nil:
		return fmt.Sprintf("Fills your empty %s while %s sits on bye.", slot, onBye.short())
	case turned:
		return fmt.Sprintf("Fills your empty %s in week %d.", slot, week)
	}
	return fmt.Sprintf("Fills your empty %s this week.", slot)
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
		return fmt.Sprintf("Our preseason order: All ranks by Over repl., %s in %s.", figurewords.Table.OverReplacement, league)
	}
	return fmt.Sprintf("Our rest-of-season order %s. A position ranks by %s through week %d%s, byes out, "+
		"All by Over repl., %s in %s.%s", restFromWords(from), figurewords.Table.Projected, h.Last,
		h.finalWords(from.Week), figurewords.Table.OverReplacement, league, h.rateWords(from.Week))
}

// secondMention is a name as a sentence names him again: his last name, a
// defense by its club ("Texans" from "Texans D/ST").
func secondMention(full string) string {
	return lastName(strings.TrimSuffix(strings.TrimSpace(full), " D/ST"))
}

// namedAtMost is how many starters a standing names before it counts them.
const namedAtMost = 3

// leadWords is the member's margin: "Up 3.2", "Down 14.1", "Tied".
func leadWords(margin float64) string {
	switch {
	case margin > 0:
		return "Up " + points(margin)
	case margin < 0:
		return "Down " + points(-margin)
	}
	return "Tied"
}

// ResultWords is a final game's result for the member: "Won by 6.4",
// "Lost by 30.4", "Tied".
func ResultWords(margin float64) string {
	switch {
	case margin > 0:
		return "Won by " + points(margin)
	case margin < 0:
		return "Lost by " + points(-margin)
	}
	return "Tied"
}

// leftWords is who a side still has: "McCaffrey and Kittle playing",
// "Kittle to play", "McCaffrey playing and Kittle to play", or past three
// names their count, "4 to play".
func leftWords(s sideLeft) string {
	if s.count() > namedAtMost {
		return fmt.Sprintf("%d to play", s.count())
	}
	var parts []string
	if len(s.playing) > 0 {
		parts = append(parts, joinNames(s.playing)+" playing")
	}
	if len(s.coming) > 0 {
		parts = append(parts, joinNames(s.coming)+" to play")
	}
	return strings.Join(parts, " and ")
}

// joinNames is "Kittle", "McCaffrey and Kittle", "Hall, Pitts and Kittle".
func joinNames(names []string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// StandingWords is the member's game while it plays (Lane 99, B31), from
// their side: "Up 3.2, 2 of yours and 1 of theirs to play", or with
// nobody of one side's left the other side's starters named, "Down 14.1
// with nobody left, McCaffrey and Kittle playing for them", "Up 6.0, they
// have nobody left, Kittle to play for you". The site never prints a
// semicolon (banned-words.json marks), so the ruling's is a comma.
func StandingWords(margin float64, mine, theirs sideLeft) string {
	lead := leadWords(margin)
	switch {
	case mine.count() == 0 && theirs.count() == 0:
		return lead
	case mine.count() == 0:
		return fmt.Sprintf("%s with nobody left, %s for them", lead, leftWords(theirs))
	case theirs.count() == 0:
		return fmt.Sprintf("%s, they have nobody left, %s for you", lead, leftWords(mine))
	}
	return fmt.Sprintf("%s, %d of yours and %d of theirs to play", lead, mine.count(), theirs.count())
}

// designationMark is a designation inside the miss line, after the name:
// "Out", "Doubtful", "on injured reserve".
func designationMark(status apitypes.DesignationStatus) string {
	switch status {
	case apitypes.DesignationStatusQuestionable:
		return "Questionable"
	case apitypes.DesignationStatusDoubtful:
		return "Doubtful"
	case apitypes.DesignationStatusOut:
		return "Out"
	case apitypes.DesignationStatusSuspended:
		return "Suspended"
	}
	return statusWords(string(status))
}

// scoredVerb is what a player in the miss line did: "scored" once his
// game is final, "has" while it plays.
func scoredVerb(state apitypes.GameState) string {
	if state == apitypes.GameStateFinal {
		return "scored"
	}
	return "has"
}

// moreWords is the slots past the named ones: "one more slot", "2 more
// slots" (Lane 108, B83).
func moreWords(n int) string {
	if n == 1 {
		return "one more slot"
	}
	return fmt.Sprintf("%d more slots", n)
}

// missSlot is a slot as the miss line names it, unnumbered as the
// Lineup's rows print it: "RB", "Flex", "D/ST".
func missSlot(t draft.SlotType) string {
	if t == draft.SlotDEF {
		return "D/ST"
	}
	if name, ok := slotNames[t]; ok {
		return name
	}
	return string(t)
}

// missSet is the set starter's half of a miss (Lane 99, B11): "DJ Moore,
// Out, scored 0.0 in your Flex", "Jahmyr Gibbs was on bye in your RB", or
// with the spot empty on the platform "Your Flex was empty".
func missSet(name, mark, verb string, pts float64, slot string, bye bool) string {
	switch {
	case name == "":
		return fmt.Sprintf("Your %s was empty", slot)
	case bye:
		return fmt.Sprintf("%s was on bye in your %s", name, slot)
	}
	if mark != "" {
		name += ", " + mark + ","
	}
	return fmt.Sprintf("%s %s %s in your %s", name, verb, points(pts), slot)
}

// missPick is our pick's half: "Josh Downs scored 8.7 on your bench".
func missPick(name, verb string, pts float64) string {
	return fmt.Sprintf("%s %s %s on your bench", name, verb, points(pts))
}

// MissWords is the Lineup's miss line (Lane 99, B11): each named slot the
// set lineup missed our pick at, its two halves joined ("DJ Moore, Out,
// scored 0.0 in your Flex while Josh Downs scored 8.7 on your bench.", the
// ruling's semicolon a "while": the site never prints one), the slots past
// those counted on the last (", and one more slot.", fix round 1, Lane
// 108), then once
// every slot is final what our lineup would have scored ("Our lineup would
// have scored 85.5.").
func MissWords(misses [][2]string, more int, ours *float64) string {
	parts := make([]string, 0, len(misses)+1)
	for i, m := range misses {
		end := "."
		if i == len(misses)-1 && more > 0 {
			end = ", and " + moreWords(more) + "."
		}
		parts = append(parts, m[0]+" while "+m[1]+end)
	}
	if ours != nil {
		parts = append(parts, fmt.Sprintf("Our lineup would have scored %s.", points(*ours)))
	}
	return strings.Join(parts, " ")
}
