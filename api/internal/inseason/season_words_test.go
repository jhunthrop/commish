package inseason

import (
	"strings"
	"testing"
)

// "Rest of season" heads one unit and a gain is headed "Gain" (Lane 66u,
// sweep X6): each basis says what Rest of season is and what Gain is, once,
// in the same words on Trades and Waivers.
func TestGainAndRestOfSeasonSaidOnce(t *testing.T) {
	if got, want := WaiverSeasonBasis(RestOfSeason, 12),
		"Gain is the change in your lineup's points over replacement a week on our rest-of-season order, averaged over its 12 weeks."; got != want {
		t.Errorf("waiver season basis %q, want %q", got, want)
	}
	if got, want := WaiversBasis(RestOfSeason),
		"A pickup starts for you this week on the Proj shown and its Gain is not below zero on our rest-of-season order. "+
			"Its drop is the one you lose least by."; got != want {
		t.Errorf("waivers basis %q, want %q", got, want)
	}
	if s := TradesBasis(RestOfSeason, 12); !strings.Contains(s, "Gain is the change in a lineup's points over replacement a week, "+
		"points above what a free pickup at each position gives you: the rest of the season on our rest-of-season order, averaged over its 12 weeks") {
		t.Errorf("trade basis %q does not say what Gain is", s)
	}
	guard(t, TradesBasis(RestOfSeason, 12))
	guard(t, TradeCheckBasis(RestOfSeason))
	f := restFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	waivers, _ := a.Waivers("", "")
	trades, _ := a.Trades("")
	// The builder opens under the Trades basis, so the two together say
	// each once (review 66u, finding 4).
	for name, basis := range map[string]string{"waivers": waivers.Basis + " " + waivers.SeasonBasis,
		"trades with the builder open": trades.Basis + " " + trades.CheckBasis} {
		if n := strings.Count(basis, RestOfSeasonBasis(7)); n != 1 {
			t.Errorf("%s says what Rest of season is %d times: %q", name, n, basis)
		}
		if n := strings.Count(basis, "Gain is the change in "); n != 1 {
			t.Errorf("%s says what Gain is %d times: %q", name, n, basis)
		}
		if strings.Contains(basis, "Points a game are") || strings.Contains(basis, "your rest of season") {
			t.Errorf("%s names the figure two ways: %q", name, basis)
		}
	}
}
