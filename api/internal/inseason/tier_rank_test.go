package inseason

import (
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// One rank per player per screen (Lane 162, D02 and D03): through both
// player routes on Sunday evening of week 6, a tier box of five backs in
// board order, the second the Mason shape (on injured reserve, due back
// on Sunday, the day of his club's game) and the fourth on injured reserve with no
// return day. The card's head reads line.position_rank; the tier box
// reads each mate's position_rank, which must be the same number from the
// same ranks: the returning back's tier rank is his line's, the listed
// back has none in either place, and every other mate's tier rank is the
// one his own read's line says. Each mate's from_week is the week his own
// read counts from.
func TestTheTierBoxRanksItsPlayersAsTheReadsLineDoes(t *testing.T) {
	s, f := restRoutes(t)
	backs := backsInBoardOrder(f.league.Board)[:5]
	since := time.Date(2026, 9, 22, 15, 0, 0, 0, time.UTC)
	listed := restSunday.Add(-24 * time.Hour)
	returning, held := backs[1], backs[3]
	f.data.Designations[returning] = boards.Designation{Code: "Injured Reserve - Designated to Return", AsOf: listed,
		Since: &since, Listed: &since, ReturnOn: eastDay(time.October, 18)}
	f.data.Designations[held] = boards.Designation{Code: "IR", AsOf: listed, Since: &since, Listed: &since}
	query := "?tier=" + strings.Join(backs, ",") + "&tier_next=" + backsInBoardOrder(f.league.Board)[5]
	for _, path := range []string{"/players/" + returning + "/week" + query, leaguePath + "players/" + returning + query} {
		out := playerWeekOf(t, s, path)
		if out.Tier == nil || len(out.Tier.Mates) != len(backs) {
			t.Fatalf("%s: tier %+v", path, out.Tier)
		}
		ranks := map[string]*int{}
		for _, mate := range out.Tier.Mates {
			ranks[mate.BoardId] = mate.PositionRank
			if mate.FromWeek == nil || out.RestFromWeek == nil || *mate.FromWeek != *out.RestFromWeek {
				t.Fatalf("%s: %s counts from %v, his read from %v", path, mate.BoardId, mate.FromWeek, out.RestFromWeek)
			}
		}
		if out.Line.PositionRank == nil || ranks[returning] == nil || *ranks[returning] != *out.Line.PositionRank {
			t.Fatalf("%s: the returning back's head %v, his tier rank %v", path, out.Line.PositionRank, ranks[returning])
		}
		if ranks[held] != nil {
			t.Fatalf("%s: the listed back is ranked %d in the tier", path, *ranks[held])
		}
		if strings.HasPrefix(path, leaguePath) {
			continue
		}
		for _, id := range backs {
			own := playerWeekOf(t, s, "/players/"+id+"/week").Line.PositionRank
			if (own == nil) != (ranks[id] == nil) || (own != nil && *own != *ranks[id]) {
				t.Fatalf("%s: his own head %v, the tier's %v", id, own, ranks[id])
			}
		}
	}
}

// backsInBoardOrder is the fixture board's running backs in its position
// order.
func backsInBoardOrder(b boards.Board) []string {
	var ids []string
	for _, p := range b.Raw.Players {
		if p.Position == draft.RB && b.PositionRanks[p.ID] > 0 {
			ids = append(ids, p.ID)
		}
	}
	sort.SliceStable(ids, func(i, j int) bool { return b.PositionRanks[ids[i]] < b.PositionRanks[ids[j]] })
	return ids
}

// A tier mate off the board carries no rank and no week, and an answer
// with no ranks (nil) gives none.
func TestATierMateOffTheBoardCarriesNoRank(t *testing.T) {
	lives, err := liveRunBoards(t.Context(), formatBoards{t}, restWeekSix(true, false), restSunday.Add(5*time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	mate := tierMate(lives[0], "nobody", map[string]int{"nobody": 3})
	if mate.PositionRank != nil || mate.FromWeek != nil || mate.Points != nil {
		t.Fatalf("off the board %+v", mate)
	}
	unranked := tierMate(lives[0], "mia", nil)
	if unranked.PositionRank != nil || unranked.FromWeek == nil || *unranked.FromWeek != 7 {
		t.Fatalf("no ranks %+v", unranked)
	}
}
