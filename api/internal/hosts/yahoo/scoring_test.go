package yahoo

import (
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/scoring"
)

// The fixture league's scoring through the one import map: half a point
// a catch, a 1-point interception, kickers by distance read as one
// figure, and what the 21 do not carry named in words with its figure.
func TestSettingsScoring(t *testing.T) {
	l, err := ParseLeague(fixture(t, "yahoo-league-head.xml"), fixture(t, "yahoo-league-rosters.xml"))
	if err != nil {
		t.Fatal(err)
	}
	im := l.Settings.Scoring()
	want := map[string]float64{
		"points_per_passing_yard": 0.04, "points_per_passing_touchdown": 4, "points_per_interception": -1,
		"points_per_rushing_yard": 0.1, "points_per_reception": 0.5, "points_per_return_touchdown": 6,
		"points_per_two_point_conversion": 2, "points_per_fumble_lost": -2, "points_per_field_goal": 3,
		"points_per_field_goal_missed": -1, "points_per_extra_point": 1, "points_per_sack": 1,
		"points_per_defensive_interception": 2, "points_per_defensive_fumble_recovery": 2,
		"points_per_defensive_touchdown": 6, "points_per_safety": 2,
	}
	for k, v := range want {
		if im.Rules[k] != v {
			t.Errorf("%s = %v, want %v", k, im.Rules[k], v)
		}
	}
	if _, err := scoring.FromMap(im.Rules); err != nil {
		t.Fatalf("the rules do not make ScoringRules: %v", err)
	}
	words := scoring.DroppedWords(im.Dropped)
	for _, w := range []string{"0 points allowed 10", "35 or more points allowed -4", "Kickoff and Punt Return Touchdowns 6", "Rushing Yards bonus at 100 3"} {
		if !slices.Contains(words, w) {
			t.Errorf("dropped %v lacks %q", words, w)
		}
	}
	for _, w := range words {
		if w == "Targets 0" {
			t.Errorf("a stat scoring 0 was named: %v", words)
		}
	}
	if !slices.Contains(im.Defaulted, "te_reception_bonus 0") {
		t.Errorf("defaulted %v", im.Defaulted)
	}
}

// A disabled stat scores nothing, and a stat Yahoo does not name is named
// by its number.
func TestSettingsScoringDisabledAndUnnamed(t *testing.T) {
	s := Settings{
		Stats:     []Stat{{ID: 4, Name: "Passing Yards", PositionType: "O", Enabled: false}},
		Modifiers: []Modifier{{StatID: 4, Points: 0.1}, {StatID: 999, Points: 2}},
	}
	im := s.Scoring()
	if im.Rules["points_per_passing_yard"] != 0.04 {
		t.Fatalf("a disabled stat was read: %v", im.Rules["points_per_passing_yard"])
	}
	if words := scoring.DroppedWords(im.Dropped); !slices.Equal(words, []string{"Yahoo stat 999 2"}) {
		t.Fatalf("dropped %v", words)
	}
}
