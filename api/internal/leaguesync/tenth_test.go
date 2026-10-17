package leaguesync

import "testing"

// A team's points for and against leave as the tenth the standings print
// (Lane 66k H1), half away from zero on the decimal.
func TestTeamOnWireRoundsOnce(t *testing.T) {
	against := 584.85
	got := TeamOnWire(Team{RosterID: 1, PointsFor: 739.45, PointsAgainst: &against})
	if got.PointsFor != 739.5 || got.PointsAgainst == nil || *got.PointsAgainst != 584.9 {
		t.Fatalf("for %v against %v, want 739.5 and 584.9", got.PointsFor, got.PointsAgainst)
	}
}
