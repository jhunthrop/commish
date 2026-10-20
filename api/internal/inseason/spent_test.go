package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// On a turned Season (Lane 95) a designation the provider still lists is
// never hidden: a week's designation listed no later than his club's last
// kickoff, or undated, keeps its status and its tier, marked carried over;
// one listed after it is fresh; a season-long one is never carried over. A
// plain Season marks nothing. Miami's last kickoff before week 3 is week
// 2's, Sunday Sep 20.
func TestTurnedSeasonKeepsEveryListing(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	plain := fixtureSeason(saturday)
	turned := plain.Turned()
	mia := Player{BoardID: "mia-rb", Team: "MIA", Position: draft.RB}
	ir := Player{BoardID: "mia-wr", Team: "MIA", Position: draft.WR}
	if d := turned.For(ir).Designation; d == nil || d.CarriedOver {
		t.Fatalf("injured reserve: %+v, want it kept and never carried over", d)
	}
	afterGame := time.Date(2026, 9, 23, 15, 0, 0, 0, time.UTC)
	beforeGame := time.Date(2026, 9, 19, 15, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name    string
		season  *Season
		listed  *time.Time
		carried bool
	}{
		{"plain, undated", plain, nil, false},
		{"turned, undated", turned, nil, true},
		{"turned, listed before his last game", turned, &beforeGame, true},
		{"turned, listed after it", turned, &afterGame, false},
	} {
		s := *tc.season
		s.designations = map[string]boards.Designation{"mia-rb": {Code: "D", AsOf: saturday, Listed: tc.listed}}
		f := s.For(mia)
		if f.Designation == nil || f.Designation.CarriedOver != tc.carried || (f.Designation.Listed != nil) != (tc.listed != nil) || f.Tier() != Doubtful {
			t.Errorf("%s: %+v tier %v, want kept, carried over %v, as dated, doubtful", tc.name, f.Designation, f.Tier(), tc.carried)
		}
	}
}
