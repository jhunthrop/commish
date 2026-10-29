package leaguerecord

import (
	"reflect"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// A 12-team ESPN lineup: QB, 2 RB, 2 WR, TE and a flex.
var espnShape = leaguesync.Shape{Teams: 12, QB: 1, RB: 2, WR: 2, TE: 1, Flex: 1, K: 1, DEF: 1, Bench: 7}

var (
	setAt    = time.Date(2026, 10, 22, 18, 0, 0, 0, time.UTC)
	readAt   = setAt.Add(-30 * time.Minute)
	gradedAt = time.Date(2026, 10, 28, 22, 0, 0, 0, time.UTC)
	after    = gradedAt.Add(time.Hour)
)

func f(v float64) *float64 { return &v }

type line struct {
	id, position, team, status string
	rank                       int
	projected, actual          float64
}

// The member's roster (team 3) and one player of another team, read before
// the order was set and again after the week was graded.
var roster = []line{
	{"a", posQB, "KC", "ACTIVE", 5, 18, 20},
	{"b", posQB, "BUF", "ACTIVE", 40, 20, 10},
	{"c", posRB, "DET", "ACTIVE", 1, 15, 25},
	{"d", posRB, "ATL", "ACTIVE", 10, 14, 5},
	{"e", posRB, "SF", "ACTIVE", 30, 16, 12},
	{"f", posRB, "MIN", "ACTIVE", 2, 0, 0}, // his club's bye week
	{"g", posWR, "SEA", "ACTIVE", 3, 17, 8},
	{"h", posWR, "LAR", "ACTIVE", 8, 12, 20},
	{"i", posWR, "NYJ", "ACTIVE", 50, 13, 3},
	{"j", posTE, "PIT", "ACTIVE", 20, 9, 7},
	{"k", posTE, "NE", "OUT", 4, 0, 0},
	{"l", "K", "DAL", "ACTIVE", 1, 30, 30},
}

// memberSet is the lineup the member set in week 7 by ESPN slot (Lane
// 292): b at quarterback, not our a; everyone else on the bench but the
// kicker.
var memberSet = map[string]int{"b": 0, "c": 2, "d": 2, "g": 4, "h": 4, "j": 6, "e": 23, "l": 17}

func reads() []Row { return readsSet(memberSet) }

// readsSet is the week's reads with the member's lineup set by slot, every
// player it does not name on the bench.
func readsSet(set map[string]int) []Row {
	var rows []Row
	for _, r := range roster {
		slot, ok := set[r.id]
		if !ok {
			slot = espn.SlotBench
		}
		base := Row{Week: 7, PlayerID: r.id, TeamID: 3, Slot: slot, Position: r.position, ProTeam: r.team, Status: r.status}
		before, later := base, base
		before.ReadAt, before.ReadPeriod, before.Projected = readAt, 7, f(r.projected)
		later.ReadAt, later.ReadPeriod, later.Projected, later.Actual = after, 7, f(r.projected), f(r.actual)
		rows = append(rows, before, later)
	}
	other := Row{Week: 7, ReadAt: readAt, ReadPeriod: 7, PlayerID: "z", TeamID: 4, Position: posQB, ProTeam: "BAL", Status: "ACTIVE", Projected: f(40)}
	return append(rows, other)
}

func order(graded *time.Time) boards.SetOrder {
	rank := map[string]int{}
	for _, r := range roster {
		rank[r.id] = r.rank
	}
	return boards.SetOrder{Week: 7, SetAt: setAt, GradedAt: graded, Rank: rank, Published: map[string]float64{"a": 1}}
}

var byes = map[string]int{"MIN": 7, "KC": 10}

// Our picks: a, c, d, g, h, j and e at flex, 97 points; ESPN's projected
// lineup: b, e, c, g, i, j and d at flex, 70 points. The bye, the Out tight
// end, the kicker and the other team's quarterback start for neither.
func TestGradeScoresOurPicksAgainstESPNsProjectedLineup(t *testing.T) {
	got := Grade([]boards.SetOrder{order(&gradedAt)}, reads(), 3, espnShape, byes)
	if len(got) != 1 || got[0].Ranking == nil {
		t.Fatalf("got %+v, want one week with its ranking", got)
	}
	// The ranking grades the nine rostered players both reads carry: the
	// bye, the Out tight end, the kicker and the quarterback the read after
	// the grading does not carry are left out.
	if got[0].Ranking.Players != 9 {
		t.Errorf("ranking over %d players", got[0].Ranking.Players)
	}
	got[0].Ranking = nil
	// The member's set lineup scored 87: b's 10 where our a scored 20.
	want := []Week{{Week: 7, Benchmark: BenchmarkESPN, Ours: 97, Theirs: 70, Margin: 27, Set: &SetLineup{Points: 87, Matched: false}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// The weekly record in the league (Lane 114): four receivers on two teams
// of a one-receiver league; our order is the finish and ESPN's projection
// its reverse, so ours matches it exactly and calls both starters, and
// ESPN's is the reverse order and calls none.
func TestRankGradesOurOrderAndESPNsOnTheLeaguesPlayers(t *testing.T) {
	cands := []Candidate{{"w1", posWR}, {"w2", posWR}, {"w3", posWR}, {"w4", posWR}}
	ours := map[string]int{"w1": 1, "w2": 2, "w3": 3, "w4": 4}
	espn := map[string]float64{"w1": 5, "w2": 10, "w3": 15, "w4": 20}
	actual := map[string]float64{"w1": 30, "w2": 20, "w3": 10, "w4": 0}
	got := rank(cands, ours, espn, actual, leaguesync.Shape{Teams: 2, WR: 1})
	if got.Players != 4 || *got.Ours.Agreement != 1 || *got.ESPN.Agreement != -1 {
		t.Fatalf("agreement ours %v, ESPN %v", *got.Ours.Agreement, *got.ESPN.Agreement)
	}
	if *got.Ours.PlacesOff != 0 || *got.ESPN.PlacesOff != 2 {
		t.Errorf("places off ours %v, ESPN %v", *got.Ours.PlacesOff, *got.ESPN.PlacesOff)
	}
	if got.Ours.Starters != 2 || got.Ours.StartersOf != 2 || got.ESPN.Starters != 0 || got.ESPN.StartersOf != 2 {
		t.Errorf("starters ours %d of %d, ESPN %d of %d", got.Ours.Starters, got.Ours.StartersOf, got.ESPN.Starters, got.ESPN.StartersOf)
	}
}

// A player ESPN does not project is tied below every one it does (the fill
// rule), never dropped, and never one of its starters.
func TestRankFillsAPlayerTheProjectionLacks(t *testing.T) {
	cands := []Candidate{{"w1", posWR}, {"w2", posWR}, {"w3", posWR}}
	espn := map[string]float64{"w2": 10, "w3": 5}
	ranks := filledRanks(cands, byPointsValue(espn))
	if ranks["w2"] != 1 || ranks["w3"] != 2 || ranks["w1"] != 3 {
		t.Fatalf("ranks %v", ranks)
	}
	right, of := startersRight(cands, byPointsValue(espn), ByPoints(espn), map[string]float64{"w1": 30, "w2": 1, "w3": 0}, leaguesync.Shape{Teams: 1, WR: 1})
	if right != 0 || of != 1 {
		t.Errorf("starters %d of %d", right, of)
	}
	if _, ok := spearman([]float64{1}, []float64{2}); ok {
		t.Error("a single player supports no correlation")
	}
}

func TestGradeWaitsForTheGradingAndTheReadAfterIt(t *testing.T) {
	if got := Grade([]boards.SetOrder{order(nil)}, reads(), 3, espnShape, byes); got != nil {
		t.Errorf("ungraded week drew %+v", got)
	}
	late := gradedAt.Add(2 * time.Hour)
	if got := Grade([]boards.SetOrder{order(&late)}, reads(), 3, espnShape, byes); got != nil {
		t.Errorf("a week with no read after its grading drew %+v", got)
	}
}

// A read taken after the order was set is no roster for it: the picks are
// made from the roster as it stood when the order was set.
func TestGradeReadsTheRosterOnlyFromBeforeTheOrderWasSet(t *testing.T) {
	o := order(&gradedAt)
	o.SetAt = readAt.Add(-time.Minute)
	if got := Grade([]boards.SetOrder{o}, reads(), 3, espnShape, byes); got != nil {
		t.Errorf("drew %+v from a read after the order was set", got)
	}
}

// With no ESPN projection on the read, the week's published projection the
// register kept picks the benchmark's lineup.
func TestGradeFallsBackToThePublishedProjection(t *testing.T) {
	rows := reads()
	for i := range rows {
		if rows[i].ReadAt.Equal(readAt) {
			rows[i].Projected = nil
		}
	}
	got := Grade([]boards.SetOrder{order(&gradedAt)}, rows, 3, espnShape, byes)
	if len(got) != 1 || got[0].Benchmark != BenchmarkPublished || got[0].Ours != 97 {
		t.Fatalf("got %+v", got)
	}
}

func TestLineupFillsEachSlotOnceAndTheFlexFromWhatIsLeft(t *testing.T) {
	cands := []Candidate{{"q", posQB}, {"r1", posRB}, {"r2", posRB}, {"r3", posRB}, {"w1", posWR}, {"t1", posTE}}
	rank := map[string]int{"r3": 1, "r1": 2, "r2": 3, "q": 4, "w1": 5, "t1": 6}
	got := Lineup(cands, espnShape, ByRank(rank))
	want := []string{"q", "r3", "r1", "w1", "t1", "r2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if Slots(espnShape) != 7 {
		t.Errorf("slots %d", Slots(espnShape))
	}
}

// Review H2: our RB c (25 points) was cut after the week. A later read of
// week 8, whose rosters no longer hold him, is not where week 7's points
// come from: the week 7 read taken after the grading still carries him, so
// both lineups score as before.
func TestGradeKeepsThePointsOfAStarterDroppedAfterTheWeek(t *testing.T) {
	rows := reads()
	cut := after.Add(20 * time.Hour)
	for _, r := range roster {
		if r.id == "c" {
			continue
		}
		rows = append(rows, Row{Week: 7, ReadAt: cut, ReadPeriod: 8, PlayerID: r.id, TeamID: 3, Position: r.position,
			ProTeam: r.team, Status: r.status, Actual: f(r.actual)})
	}
	got := Grade([]boards.SetOrder{order(&gradedAt)}, rows, 3, espnShape, byes)
	if len(got) != 1 || got[0].Ours != 97 || got[0].Theirs != 70 {
		t.Fatalf("got %+v", got)
	}
}

// A starter the week's own read after the grading does not carry is never
// counted as none: the week is not graded rather than drawn wrong.
func TestGradeSkipsAWeekWhoseReadLacksAStarter(t *testing.T) {
	var rows []Row
	for _, r := range reads() {
		if r.PlayerID == "c" && r.ReadAt.Equal(after) {
			continue
		}
		rows = append(rows, r)
	}
	if got := Grade([]boards.SetOrder{order(&gradedAt)}, rows, 3, espnShape, byes); got != nil {
		t.Fatalf("drew %+v with a starter's points missing", got)
	}
}
