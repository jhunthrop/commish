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

func TestTradesBasisSaysWhoDecidesAndGainOnce(t *testing.T) {
	want := "Each team's best trade both lineups gain by, yours first. The other team decides. " +
		"Gain is the change in a lineup's points over replacement, a week, over the 12 weeks left on our order."
	if got := TradesBasis(RestOfSeason, 12); got != want {
		t.Errorf("rest of season:\n got %q\nwant %q", got, want)
	}
	if got := TradesBasis(Preseason, 17); got != "Each team's best trade both lineups gain by, yours first. The other team decides. "+
		"Gain is the change in a lineup's points over replacement, a week, over the season's 17 weeks on our preseason number." {
		t.Errorf("preseason: %q", got)
	}
	if got := TradesBasis(RestOfSeason, 1); got != "Each team's best trade both lineups gain by, yours first. The other team decides. "+
		"Gain is the change in a lineup's points over replacement, a week, over the one week left on our order." {
		t.Errorf("one week: %q", got)
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
	if WaiversBasis != "A pickup starts this week on Proj and keeps your Gain at zero or better. Its drop costs least." {
		t.Errorf("%q", WaiversBasis)
	}
	if got := WaiverSeasonBasis(RestOfSeason, 12); got != "Gain is the change in your lineup's points over replacement, a week, over the 12 weeks left on our order." {
		t.Errorf("%q", got)
	}
}

func TestUncountedRulesAreCountedAndListed(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerFieldGoalMissed, rules.PointsPerReturnTouchdown, rules.PointsPerDefensiveFumbleRecovery = 0, 0, 0
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1}}
	got := UncountedOf(settings, nil)
	if got.Note != "Avg and Last miss four of your rules our stats lack." || got.Link != "Which four" {
		t.Errorf("note %q link %q", got.Note, got.Link)
	}
	want := []string{"two-point conversions", "safeties", "a defense's points allowed", "a defense's yards allowed"}
	if !reflect.DeepEqual(got.Rules, want) {
		t.Errorf("rules %v", got.Rules)
	}
	one := UncountedOf(settings, func(m string) bool { return m != "safeties" })
	if one.Note != "Avg and Last miss one of your rules our stats lack." || one.Link != "Which one" {
		t.Errorf("one: %q %q", one.Note, one.Link)
	}
	none := UncountedOf(settings, func(string) bool { return true })
	if none.Note != "" || none.Link != "" || none.Rules == nil || len(none.Rules) != 0 {
		t.Errorf("none: %+v", none)
	}
}

func TestOrderScreenBasisNamesItsLeague(t *testing.T) {
	want := "Our rest-of-season order from week 6. A position ranks by Projected through week 17, byes out, " +
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
	if got := PerGameBasis(); got != "A game is that order's points a game." {
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
	if out.BasisNote != "" || out.BasisNoteLink != "" {
		t.Errorf("no league, note %q %q", out.BasisNote, out.BasisNoteLink)
	}
}
