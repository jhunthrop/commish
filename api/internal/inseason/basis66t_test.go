package inseason

import (
	"reflect"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Lane 66t: each in-season basis names only its own columns, says each
// thing once and fits five lines at a desk and eight on a phone.

// Lane 103: the footer says who decides and the keep rule in one
// sentence; what a Gain is sits under the heads (B42).
func TestTradesBasisSaysWhoDecidesAndTheKeepRule(t *testing.T) {
	want := "Each team's best trades, those for your weakest starting spot first. Every one fills a weak spot on one side or both, " +
		"and neither lineup loses by it. The other team decides. A player we rank first at his position goes only for 1.0 a week or more, or to fill a spot."
	for _, b := range []OrderBasis{RestOfSeason, Preseason} {
		if got := TradesBasis(b, 12, StandardHorizon); got != want {
			t.Errorf("%v:\n got %q\nwant %q", b, got, want)
		}
	}
	for weeks, want := range map[int]string{12: "points over replacement in each lineup week by week, byes counted, weeks 6 to 17", 1: "points over replacement in each lineup week by week, byes counted, week 17"} {
		if got := TradeGainBasis(RestOfSeason, weeks, StandardHorizon); got != want {
			t.Errorf("%d weeks: %q", weeks, got)
		}
	}
	if got := TradeGainBasis(Preseason, 17, StandardHorizon); got != "points over replacement in each lineup week by week, byes counted, over the season's 17 weeks on our preseason number" {
		t.Errorf("preseason: %q", got)
	}
}

func TestBuilderLinePointsAtThePage(t *testing.T) {
	if TradeCheckBasis != "The scoreboard is each lineup before and after the trade." {
		t.Errorf("%q", TradeCheckBasis)
	}
}

func TestLineupAndWaiverRules(t *testing.T) {
	if got := LineupBasis(RestOfSeason); got != "We start the highest Proj at each slot after designations and byes, our order breaking ties." {
		t.Errorf("%q", got)
	}
	if got := LineupBasis(Preseason); got != "We start the highest Proj at each slot after designations and byes, our preseason number breaking ties." {
		t.Errorf("%q", got)
	}
	if WaiversBasis != "A pickup starts this week on Proj and keeps Gain at zero or better." {
		t.Errorf("%q", WaiversBasis)
	}
	if got := WaiverSeasonBasis(RestOfSeason, 12, StandardHorizon); got != "Gain is your lineup's change in points over replacement a week, weeks 6 to 17." {
		t.Errorf("%q", got)
	}
}

// The rules Avg and Last leave out are named inline (Lane 111, B33), the
// Settings list keeps its own words, and no link words are sent (Lane 118).
func TestUncountedRulesAreNamedAndListed(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerFieldGoalMissed, rules.PointsPerReturnTouchdown, rules.PointsPerDefensiveFumbleRecovery = 0, 0, 0
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1}}
	got := UncountedOf(settings, nil)
	if got.Note != "Our stats omit two-point, safety, points allowed and yards allowed." {
		t.Errorf("note %q", got.Note)
	}
	want := []string{"two-point conversions", "safeties", "a defense's points allowed", "a defense's yards allowed"}
	if !reflect.DeepEqual(got.Rules, want) {
		t.Errorf("rules %v", got.Rules)
	}
	one := UncountedOf(settings, func(m string) bool { return m != "safeties" })
	if one.Note != "Our stats omit safety." {
		t.Errorf("one: %q", one.Note)
	}
	two := UncountedOf(settings, func(m string) bool { return m != "safeties" && m != "two_point_conversions" })
	if two.Note != "Our stats omit two-point and safety." {
		t.Errorf("two: %q", two.Note)
	}
	// Both missed kicks left out are one missed kick; one alone keeps its name.
	rules.PointsPerFieldGoalMissed, rules.PointsPerExtraPointMissed = -1, -1
	kicks := UncountedOf(settings, func(m string) bool { return m != "field_goals_missed" && m != "extra_points_missed" })
	if kicks.Note != "Our stats omit missed kick." || len(kicks.Rules) != 2 {
		t.Errorf("kicks: %q %v", kicks.Note, kicks.Rules)
	}
	extra := UncountedOf(settings, func(m string) bool { return m != "extra_points_missed" })
	if extra.Note != "Our stats omit missed extra point." {
		t.Errorf("extra point: %q", extra.Note)
	}
	if got.Names != "two-point, safety, points allowed and yards allowed" {
		t.Errorf("names %q", got.Names)
	}
	none := UncountedOf(settings, func(string) bool { return true })
	if none.Note != "" || none.Rules == nil || len(none.Rules) != 0 {
		t.Errorf("none: %+v", none)
	}
}

// Past four rules the sentence names four and counts the rest (Lane 115,
// B92), so a league scoring every uncounted rule keeps a phone's footer;
// Names is the same words for the web's own frame.
func TestUncountedRulesNameFourThenCountTheRest(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerFieldGoalMissed, rules.PointsPerReturnTouchdown, rules.PointsPerDefensiveFumbleRecovery = -1, 6, 2
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1}}
	got := UncountedOf(settings, nil)
	if len(got.Rules) <= namedRulesMost {
		t.Fatalf("the case needs more than four rules: %v", got.Rules)
	}
	more := moreRules(len(basisNames(uncountedRules(settings, nil))) - namedRulesMost)
	wantNames := "two-point, missed field goal, return touchdown, fumble recovery and " + more
	if got.Names != wantNames || got.Note != "Our stats omit "+wantNames+"." {
		t.Errorf("names %q note %q", got.Names, got.Note)
	}
	// Four are named whole.
	four := UncountedOf(settings, func(m string) bool {
		return m != "two_point_conversions" && m != "safeties" && m != metricPointsAllowed && m != metricYardsAllowed
	})
	if four.Note != "Our stats omit two-point, safety, points allowed and yards allowed." {
		t.Errorf("four: %q", four.Note)
	}
}

// The count closes the sentence with the word rules, one rule or more
// (Lane 121, B97): "and two more rules.", "and one more rule.".
func TestUncountedRulesCountedPastFourEndOnRules(t *testing.T) {
	names := []string{"two-point", "missed kick", "fumble recovery", "safety", "return touchdown", "yards allowed"}
	if got := andList(cappedNames(names)); got != "two-point, missed kick, fumble recovery, safety and two more rules" {
		t.Errorf("six: %q", got)
	}
	if got := andList(cappedNames(names[:5])); got != "two-point, missed kick, fumble recovery, safety and one more rule" {
		t.Errorf("five: %q", got)
	}
	if got := andList(cappedNames(names[:4])); got != "two-point, missed kick, fumble recovery and safety" {
		t.Errorf("four: %q", got)
	}
}

func TestOrderScreenBasisNamesItsLeague(t *testing.T) {
	want := "Our rest-of-season order from week 6. A position ranks by Projected through week 17, byes out, " +
		"All by Over repl., his points less a free pickup's in your league."
	if got := OrderScreenBasis(RestOfSeason, RestFrom{Week: 6}, OrderLeague(true, apitypes.LeagueSettings{}, apitypes.ProjectionScoringFormatPpr), StandardHorizon); got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
	stand := OrderLeague(false, apitypes.LeagueSettings{Teams: 12}, apitypes.ProjectionScoringFormatPpr)
	if stand != "a 12-team PPR league" {
		t.Errorf("%q", stand)
	}
	if got := OrderScreenBasis(Preseason, RestFrom{}, stand, StandardHorizon); got != "Our preseason order: All ranks by Over repl., his points less a free pickup's in a 12-team PPR league." {
		t.Errorf("%q", got)
	}
}

func TestPerGameSentenceUsesTheFigureWord(t *testing.T) {
	if got := PerGameBasis(); got != "A game is our order's points a game." {
		t.Errorf("%q", got)
	}
}

// The order's rows carry the figure a game, so its basis says what it is;
// a reader with no league is told of no rules of theirs.
func TestOrderSaysTheFigureAGame(t *testing.T) {
	a := newFixtureAdvisor(t, restFixture(t), nil)
	out := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	if !strings.HasSuffix(out.Basis, " "+PerGameBasis()) {
		t.Errorf("%q", out.Basis)
	}
	if out.BasisNote != "" {
		t.Errorf("no league, note %q", out.BasisNote)
	}
}
