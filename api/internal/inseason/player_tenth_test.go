package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// The public player read leaves his projection and its change as the tenth
// the card prints (Lane 66k rereview N1): 9.45 is 9.5, and the change from
// 8.25 (8.3) is +1.2, the site's one rule.
func TestThePublicPlayerWeekLeavesAsTheTenth(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season = 2026
	bp := f.raw.Players[0]
	before := &boards.WeekProjection{Players: map[string]boards.ProjectedPoints{bp.ID: {PPR: 8.25}}}
	s.Facts = fakeFacts{data: f.data, projection: boards.WeekProjection{ReadAt: fixtureNow,
		Players: map[string]boards.ProjectedPoints{bp.ID: {PPR: 9.45}}, Previous: before}}
	s.Boards = fakeBoards{board: f.league.Board}
	out := playerWeekOf(t, s, "/players/"+bp.ID+"/week")
	if out.Line.WeekProjection == nil || *out.Line.WeekProjection != 9.5 {
		t.Fatalf("projection %v, want 9.5", orNone(out.Line.WeekProjection))
	}
	if out.Line.ProjectionDelta == nil || *out.Line.ProjectionDelta != 1.2 {
		t.Fatalf("change %v, want 1.2", orNone(out.Line.ProjectionDelta))
	}
}
