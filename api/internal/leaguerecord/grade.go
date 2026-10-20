package leaguerecord

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// The lineup each week's picks are graded against: ESPN's projected
// lineup where the week's read before the order was set carries ESPN's
// projection, else the lineup the week's published projection picks
// where the register kept it.
const (
	BenchmarkESPN      = "espn"
	BenchmarkPublished = "published"
)

// sidelined is ESPN's injuryStatus for a player who does not play: no
// lineup starts him, whatever its order says.
var sidelined = map[string]bool{"OUT": true, "INJURY_RESERVE": true, "SUSPENSION": true}

// Week is one graded week of the member's team: the points our picks
// scored and the points the benchmark's lineup scored, from the same
// roster into the same slots, as the league scores.
type Week struct {
	Week      int
	Benchmark string
	Ours      float64
	Theirs    float64
	// Margin is ours less theirs, to the tenth, so the page prints it as given.
	Margin float64
}

// Grade is every week the register has graded whose roster was read
// before the order was set and whose points were read after the grading:
// the member's team's lineup by our set order against the benchmark's.
// A player on a bye, out, suspended or on injured reserve at the read is
// in neither lineup; kickers and defenses are in neither.
func Grade(orders []boards.SetOrder, rows []Row, team int, shape leaguesync.Shape, byes map[string]int) []Week {
	var out []Week
	for _, order := range orders {
		if wk, ok := weekOf(order, rows, team, shape, byes); ok {
			out = append(out, wk)
		}
	}
	return out
}

// weekOf grades one set order, false where the week cannot be graded yet
// or honestly: no roster read before the order was set, no read of the
// week's own period after its grading, no benchmark, or a starter of
// either lineup the points read does not carry (he would count as none).
func weekOf(order boards.SetOrder, rows []Row, team int, shape leaguesync.Shape, byes map[string]int) (Week, bool) {
	if order.GradedAt == nil {
		return Week{}, false
	}
	roster, projected, ok := rosterAt(rows, order.Week, team, order.SetAt)
	if !ok {
		return Week{}, false
	}
	actual, carried, ok := pointsAfter(rows, order.Week, *order.GradedAt)
	if !ok {
		return Week{}, false
	}
	cands := candidates(roster, order.Week, byes)
	benchmark, stance := benchmarkFor(cands, projected, order.Published)
	if stance == nil {
		return Week{}, false
	}
	ourPicks, theirPicks := Lineup(cands, shape, ByRank(order.Rank)), Lineup(cands, shape, stance)
	for _, id := range append(append([]string(nil), ourPicks...), theirPicks...) {
		if !carried[id] {
			return Week{}, false
		}
	}
	ours, theirs := tenth.Round(Scored(ourPicks, actual)), tenth.Round(Scored(theirPicks, actual))
	return Week{Week: order.Week, Benchmark: benchmark, Ours: ours, Theirs: theirs, Margin: tenth.Round(ours - theirs)}, true
}

// rosterAt is the team's rows on the newest read of the week asked for
// the week itself and taken at or before the order was set, with ESPN's
// projection for each; false with no such read.
func rosterAt(rows []Row, week, team int, setAt time.Time) ([]Row, map[string]float64, bool) {
	var newest time.Time
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && !r.ReadAt.After(setAt) && r.ReadAt.After(newest) {
			newest = r.ReadAt
		}
	}
	if newest.IsZero() {
		return nil, nil, false
	}
	var roster []Row
	projected := map[string]float64{}
	for _, r := range rows {
		if r.Week == week && r.ReadAt.Equal(newest) && r.TeamID == team {
			roster = append(roster, r)
			if r.Projected != nil {
				projected[r.PlayerID] = *r.Projected
			}
		}
	}
	return roster, projected, len(roster) > 0
}

// pointsAfter is every player's points for the week on the newest read of
// the week's own period taken after the register graded it (Lane 93 review
// H2): that read's rosters are the week's, so a starter dropped since still
// carries what he scored. carried is every player on any roster of that
// read; one with no points split there played no snap and scored none.
// False with no such read yet.
func pointsAfter(rows []Row, week int, gradedAt time.Time) (map[string]float64, map[string]bool, bool) {
	var newest time.Time
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && !r.ReadAt.Before(gradedAt) && r.ReadAt.After(newest) {
			newest = r.ReadAt
		}
	}
	if newest.IsZero() {
		return nil, nil, false
	}
	out, carried := map[string]float64{}, map[string]bool{}
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && r.ReadAt.Equal(newest) {
			carried[r.PlayerID] = true
			if r.Actual != nil {
				out[r.PlayerID] = *r.Actual
			}
		}
	}
	return out, carried, true
}

func candidates(roster []Row, week int, byes map[string]int) []Candidate {
	var out []Candidate
	for _, r := range roster {
		if !superFlexPool[r.Position] || sidelined[r.Status] || byes[r.ProTeam] == week {
			continue
		}
		out = append(out, Candidate{ID: r.PlayerID, Position: r.Position})
	}
	return out
}

// benchmarkFor is ESPN's projection where it projects any candidate,
// else the week's published projection where it does, else none.
func benchmarkFor(cands []Candidate, espn, published map[string]float64) (string, Stance) {
	for _, source := range []struct {
		name   string
		points map[string]float64
	}{{BenchmarkESPN, espn}, {BenchmarkPublished, published}} {
		for _, c := range cands {
			if _, ok := source.points[c.ID]; ok {
				return source.name, ByPoints(source.points)
			}
		}
	}
	return "", nil
}
