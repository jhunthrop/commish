package inseason

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// orderOfRoute is the order a route answers.
func orderOfRoute(t *testing.T, s *Service, path string) apitypes.OrderAdvice {
	t.Helper()
	code, env := serve(t, s, path)
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%s: %d %+v", path, code, env.Error)
	}
	var out apitypes.OrderAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// overallOn is a player's overall_rank on an order's answer, 0 when the
// answer has no row for him.
func overallOn(t *testing.T, out apitypes.OrderAdvice, id string) int {
	t.Helper()
	for _, row := range out.Rows {
		if *row.Line.Player.BoardId != id {
			continue
		}
		if row.OverallRank == nil {
			t.Fatalf("%s's row carries no overall_rank", id)
		}
		return *row.OverallRank
	}
	return 0
}

// Lane 227 (B206 and B209) through the routes: the player read's PPR
// figure says the number the public order gives him with byes=last
// (overall_rank, at his position and across positions), and the head's
// position rank, on both player routes.
func TestThePlayerReadsFormatRanksAreThePublicOrdersNumbers(t *testing.T) {
	s, f := restRoutes(t)
	checked := 0
	for _, bp := range f.raw.Players[:12] {
		if !orderPositions[bp.Position] {
			continue
		}
		across := overallOn(t, orderOfRoute(t, s, "/order?byes=last&limit=400"), bp.ID)
		at := overallOn(t, orderOfRoute(t, s, "/order?byes=last&limit=400&position="+string(bp.Position)), bp.ID)
		for i, path := range []string{"/players/" + bp.ID + "/week", leaguePath + "players/" + bp.ID} {
			out := playerWeekOf(t, s, path)
			fig := figureOf(t, out, apitypes.BoardFormatPpr)
			if fig.PositionRank == nil || fig.OverallRank == nil {
				t.Fatalf("%s: position %v, overall %v", path, fig.PositionRank, fig.OverallRank)
			}
			if *fig.PositionRank != at || *fig.OverallRank != across {
				t.Fatalf("%s: figure %d and %d, the order's %d and %d", path, *fig.PositionRank, *fig.OverallRank, at, across)
			}
			// The public read's head is the public order's own rank; a league's is the league's.
			if i == 0 && (out.Line.PositionRank == nil || *out.Line.PositionRank != at) {
				t.Fatalf("%s: the head says %v, the figure %d", path, out.Line.PositionRank, at)
			}
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no player checked")
	}
}

// figureOf is the read's figure for a format, failing without one.
func figureOf(t *testing.T, out apitypes.PlayerWeek, format apitypes.BoardFormat) apitypes.RestOfSeasonFigure {
	t.Helper()
	if out.RestOfSeason == nil {
		t.Fatal("no rest-of-season figures")
	}
	for _, fig := range *out.RestOfSeason {
		if fig.Format == format {
			return fig
		}
	}
	t.Fatalf("no %s figure", format)
	return apitypes.RestOfSeasonFigure{}
}
