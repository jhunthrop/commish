package inseason

import (
	"reflect"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Lane 66t: each in-season basis names only its own columns, says each
// thing once and fits five lines at a desk and eight on a phone.

func TestTradesBasisSaysWhoDecidesAndGainOnce(t *testing.T) {
	want := "Each team's best trade both lineups gain by, yours first. The other team decides. " +
		"Gain is the change in a lineup's points over replacement, a week, averaged over the 12 weeks left on our rest-of-season order."
	if got := TradesBasis(RestOfSeason, 12); got != want {
		t.Errorf("rest of season:\n got %q\nwant %q", got, want)
	}
	if got := TradesBasis(Preseason, 17); got != "Each team's best trade both lineups gain by, yours first. The other team decides. "+
		"Gain is the change in a lineup's points over replacement, a week, averaged over the season's 17 weeks on our preseason number." {
		t.Errorf("preseason: %q", got)
	}
	if got := TradesBasis(RestOfSeason, 1); got != "Each team's best trade both lineups gain by, yours first. The other team decides. "+
		"Gain is the change in a lineup's points over replacement, a week, averaged over the one week left on our rest-of-season order." {
		t.Errorf("one week: %q", got)
	}
}

func TestBuilderLinePointsAtThePage(t *testing.T) {
	if TradeCheckBasis != "The scoreboard is each lineup before and after the trade." {
		t.Errorf("%q", TradeCheckBasis)
	}
}

func TestLineupAndWaiverRules(t *testing.T) {
	if got := LineupBasis(RestOfSeason); got != "We start the highest Proj at each slot after designations and byes, our order breaking ties and standing in for a missing Proj." {
		t.Errorf("%q", got)
	}
	if got := LineupBasis(Preseason); got != "We start the highest Proj at each slot after designations and byes, our preseason number breaking ties and standing in for a missing Proj." {
		t.Errorf("%q", got)
	}
	if WaiversBasis != "A pickup starts for you this week on Proj and keeps your Gain at zero or better. Its drop costs you least." {
		t.Errorf("%q", WaiversBasis)
	}
	if got := WaiverSeasonBasis(RestOfSeason, 12); got != "Gain is the change in your lineup's points over replacement, a week, averaged over the 12 weeks left on our rest-of-season order." {
		t.Errorf("%q", got)
	}
}

func TestUncountedRulesAreCountedAndListed(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerFieldGoalMissed, rules.PointsPerReturnTouchdown, rules.PointsPerDefensiveFumbleRecovery = 0, 0, 0
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1}}
	got := UncountedOf(settings, nil)
	if got.Note != "Avg and Last leave out four of your scoring rules our stats lack." || got.Link != "Which four" {
		t.Errorf("note %q link %q", got.Note, got.Link)
	}
	want := []string{"two-point conversions", "safeties", "a defense's points allowed", "a defense's yards allowed"}
	if !reflect.DeepEqual(got.Rules, want) {
		t.Errorf("rules %v", got.Rules)
	}
	one := UncountedOf(settings, func(m string) bool { return m != "safeties" })
	if one.Note != "Avg and Last leave out one of your scoring rules our stats lack." || one.Link != "Which one" {
		t.Errorf("one: %q %q", one.Note, one.Link)
	}
	none := UncountedOf(settings, func(string) bool { return true })
	if none.Note != "" || none.Link != "" || none.Rules == nil || len(none.Rules) != 0 {
		t.Errorf("none: %+v", none)
	}
}

func TestOrderScreenBasisNamesItsLeague(t *testing.T) {
	want := "Our rest-of-season order from week 6: Points through week 17, byes out. Positions rank by Points, " +
		"All by Over repl., his points less a free pickup's in your league."
	if got := OrderScreenBasis(RestOfSeason, 6, OrderLeague(true, apitypes.LeagueSettings{}, apitypes.ProjectionScoringFormatPpr)); got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
	stand := OrderLeague(false, apitypes.LeagueSettings{Teams: 12}, apitypes.ProjectionScoringFormatPpr)
	if stand != "a 12-team PPR league" {
		t.Errorf("%q", stand)
	}
	if got := OrderScreenBasis(Preseason, 0, stand); got != "Our preseason order: All ranks by Over repl., his season less a free pickup's in a 12-team PPR league." {
		t.Errorf("%q", got)
	}
}

func TestPerGameSentenceUsesTheFigureWord(t *testing.T) {
	if got := PerGameBasis(); got != "A game is his rest-of-season points over the games his club has left." {
		t.Errorf("%q", got)
	}
}
