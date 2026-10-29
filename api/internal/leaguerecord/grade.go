package leaguerecord

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/espn"
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
	// Ranking is the week's weekly record in the league (Lane 114): our
	// order and ESPN's projection graded on every rostered player, as the
	// league scores; nil where the benchmark is not ESPN's.
	Ranking *Ranking
	// Set is the lineup the member set that week (Lane 292), nil where
	// the played week's read holds no starter of theirs at the graded slots.
	Set *SetLineup
}

// SetLineup is the member's own lineup for a graded week: its points at
// the graded slots, as the league scores, and whether it started the same
// players as our picks.
type SetLineup struct {
	Points  float64
	Matched bool
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
	out := Week{Week: order.Week, Benchmark: benchmark, Ours: ours, Theirs: theirs, Margin: tenth.Round(ours - theirs)}
	if set := setLineupOf(rows, order.Week, team, *order.GradedAt); len(set) > 0 {
		out.Set = &SetLineup{Points: tenth.Round(Scored(set, actual)), Matched: sameStarters(set, ourPicks)}
	}
	if benchmark == BenchmarkESPN {
		league, _ := leagueAt(rows, order.Week, order.SetAt)
		var graded []Candidate
		for _, c := range candidates(league, order.Week, byes) {
			if carried[c.ID] {
				graded = append(graded, c)
			}
		}
		ranking := rank(graded, order.Rank, projectedOf(league), actual, shape)
		out.Ranking = &ranking
	}
	return out, true
}

// leagueAt is every team's rows on the newest read of the week asked for
// the week itself and taken at or before the order was set; false with no
// such read.
func leagueAt(rows []Row, week int, setAt time.Time) ([]Row, bool) {
	var newest time.Time
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && !r.ReadAt.After(setAt) && r.ReadAt.After(newest) {
			newest = r.ReadAt
		}
	}
	if newest.IsZero() {
		return nil, false
	}
	var out []Row
	for _, r := range rows {
		if r.Week == week && r.ReadAt.Equal(newest) {
			out = append(out, r)
		}
	}
	return out, true
}

// projectedOf is ESPN's projection for each player of the rows that carry one.
func projectedOf(rows []Row) map[string]float64 {
	out := map[string]float64{}
	for _, r := range rows {
		if r.Projected != nil {
			out[r.PlayerID] = *r.Projected
		}
	}
	return out
}

// rosterAt is the team's rows on the newest read of the week asked for
// the week itself and taken at or before the order was set, with ESPN's
// projection for each; false with no such read.
func rosterAt(rows []Row, week, team int, setAt time.Time) ([]Row, map[string]float64, bool) {
	league, ok := leagueAt(rows, week, setAt)
	if !ok {
		return nil, nil, false
	}
	var roster []Row
	for _, r := range league {
		if r.TeamID == team {
			roster = append(roster, r)
		}
	}
	return roster, projectedOf(roster), len(roster) > 0
}

// pointsAfter is every player's points for the week on the newest read of
// the week's own period taken after the register graded it (Lane 93 review
// H2): that read's rosters are the week's, so a starter dropped since still
// carries what he scored. carried is every player on any roster of that
// read; one with no points split there played no snap and scored none.
// False with no such read yet.
func pointsAfter(rows []Row, week int, gradedAt time.Time) (map[string]float64, map[string]bool, bool) {
	newest := playedRead(rows, week, gradedAt)
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

// playedRead is when the newest read of the week's own period taken after
// the register graded it was taken, zero with none.
func playedRead(rows []Row, week int, gradedAt time.Time) time.Time {
	var newest time.Time
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && !r.ReadAt.Before(gradedAt) && r.ReadAt.After(newest) {
			newest = r.ReadAt
		}
	}
	return newest
}

// setLineupOf is the team's starters at the graded slots on the played week's
// read (playedRead, the read pointsAfter scores): every quarterback,
// running back, receiver and tight end the read holds in a starting slot,
// neither the bench nor injured reserve. ESPN's read of a past period
// carries each roster's slots as they stood then.
func setLineupOf(rows []Row, week, team int, gradedAt time.Time) []string {
	newest := playedRead(rows, week, gradedAt)
	if newest.IsZero() {
		return nil
	}
	var out []string
	for _, r := range rows {
		if r.Week == week && r.ReadPeriod == week && r.ReadAt.Equal(newest) && r.TeamID == team &&
			superFlexPool[r.Position] && r.Slot != espn.SlotBench && r.Slot != espn.SlotReserve {
			out = append(out, r.PlayerID)
		}
	}
	return out
}

// sameStarters is whether two lineups start the same players, in any slot.
func sameStarters(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	in := make(map[string]bool, len(a))
	for _, id := range a {
		in[id] = true
	}
	for _, id := range b {
		if !in[id] {
			return false
		}
	}
	return true
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
