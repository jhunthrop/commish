package inseason

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The order's rows carry the platform's points for a rostered player whose
// game is final (Lane 92, B36), any roster's, so the week column prints
// Pts once final; a free agent has none from the platform.
func TestOrderRowsCarryTheirRostersPoints(t *testing.T) {
	f, projection := liveFixture(t)
	f.league.Snap.Matchups[1].PlayerPoints["h016"] = 27.9
	s := liveService(t, f, projection)
	code, env := serve(t, s, leaguePath+"order?limit=200")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("order: %d %+v", code, env.Error)
	}
	var order apitypes.OrderAdvice
	if err := json.Unmarshal(env.Data, &order); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range order.Rows {
		if row.Line.Player.HostId != "h016" {
			continue
		}
		found = true
		if got := row.Line.Facts.PointsThisWeek; got == nil || *got != 27.9 {
			t.Errorf("h016, final on team 2, points %v, want 27.9", got)
		}
	}
	if !found {
		t.Fatal("h016 is not on the order")
	}
}
