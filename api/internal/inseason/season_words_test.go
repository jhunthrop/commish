package inseason

import (
	"strings"
	"testing"
)

// The figure a game heads one unit and a gain is headed "Gain" (Lane 66u,
// 66t, sweep X6): each screen says what the figure is and what Gain is,
// once, in the same words on Trades and Waivers.
func TestGainAndPerGameSaidOnce(t *testing.T) {
	guard(t, TradesBasis(RestOfSeason, 12, StandardHorizon))
	guard(t, TradeGainBasis(RestOfSeason, 12, StandardHorizon))
	guard(t, TradeCheckBasis)
	guard(t, WaiversBasis)
	guard(t, PerGameBasis())
	f := restFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	waivers, _ := a.Waivers("", "")
	trades, _ := a.Trades("")
	// The builder opens under the Trades basis, so the two together say
	// each once (review 66u, finding 4).
	// Trades says what Gain is under its heads (Lane 103, B42), the footer never.
	if trades.GainBasis == nil || strings.Contains(trades.Basis, "over replacement") {
		t.Errorf("trades: gain basis %v, footer %q", trades.GainBasis, trades.Basis)
	}
	for name, basis := range map[string]string{"waivers": waivers.Basis + " " + waivers.SeasonBasis,
		"trades with the builder open": trades.Basis + " " + trades.PerGameBasis + " " + trades.CheckBasis} {
		if n := strings.Count(basis, PerGameBasis()); n != 1 {
			t.Errorf("%s says what a game is %d times: %q", name, n, basis)
		}
		if n := strings.Count(basis, " change in points over replacement"); name == "waivers" && n != 1 {
			t.Errorf("%s says what Gain is %d times: %q", name, n, basis)
		}
		if strings.Contains(basis, "Points a game are") || strings.Contains(basis, "Rest of season is") {
			t.Errorf("%s names the figure two ways: %q", name, basis)
		}
	}
}
