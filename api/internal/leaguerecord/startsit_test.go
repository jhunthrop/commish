package leaguerecord

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/espn"
)

// The member set our picks (a, c, d, g, h, j and e at flex), the kicker
// beside them and the Out tight end on injured reserve: the set lineup
// matches ours and scores our 97, the kicker and the reserve not counted.
func TestSetLineupMatchingOurPicksScoresOurs(t *testing.T) {
	set := map[string]int{"a": 0, "c": 2, "d": 2, "g": 4, "h": 4, "j": 6, "e": 23, "l": 17, "k": espn.SlotReserve}
	got := Grade([]boards.SetOrder{order(&gradedAt)}, readsSet(set), 3, espnShape, byes)
	if len(got) != 1 || got[0].Set == nil {
		t.Fatalf("got %+v, want one week with the set lineup", got)
	}
	if *got[0].Set != (SetLineup{Points: 97, Matched: true}) {
		t.Errorf("set %+v, want 97 matched", *got[0].Set)
	}
}

// A member who started the Out tight end over j: not matched, and his 0
// counts in the set lineup's points (97 less j's 7).
func TestSetLineupCountsAnOutStarter(t *testing.T) {
	set := map[string]int{"a": 0, "c": 2, "d": 2, "g": 4, "h": 4, "k": 6, "e": 23}
	got := Grade([]boards.SetOrder{order(&gradedAt)}, readsSet(set), 3, espnShape, byes)
	if len(got) != 1 || got[0].Set == nil || *got[0].Set != (SetLineup{Points: 90, Matched: false}) {
		t.Fatalf("got %+v, want 90 not matched", got)
	}
}

// A played week's read that holds no starter of the member's at the
// graded slots (every one benched) carries no set lineup; the week is
// still graded.
func TestNoSetLineupWithEveryoneBenched(t *testing.T) {
	got := Grade([]boards.SetOrder{order(&gradedAt)}, readsSet(map[string]int{}), 3, espnShape, byes)
	if len(got) != 1 || got[0].Set != nil {
		t.Fatalf("got %+v, want the week graded with no set lineup", got)
	}
}

// A week not yet played (no read after the grading) is not graded, so it
// carries no set lineup: the record counts played weeks only.
func TestNoRecordBeforeTheWeekIsPlayed(t *testing.T) {
	early := gradedAt.Add(48 * time.Hour)
	got := Grade([]boards.SetOrder{order(&early)}, reads(), 3, espnShape, byes)
	if len(got) != 0 {
		t.Fatalf("got %+v, want no graded week", got)
	}
	if _, ok := StartSitOf(got); ok {
		t.Error("a record with no played week")
	}
}

// The record sums each week's printed tenths: two of three weeks matched,
// our picks 12.4 and 0 and -3.1 over the set lineup's, 9.3 in all; a week
// with no set lineup is not counted.
func TestStartSitSumsTheWeeksWithASetLineup(t *testing.T) {
	weeks := []Week{
		{Week: 5, Ours: 100.4, Set: &SetLineup{Points: 88, Matched: false}},
		{Week: 6, Ours: 91.2, Set: &SetLineup{Points: 91.2, Matched: true}},
		{Week: 7, Ours: 80},
		{Week: 8, Ours: 70.1, Set: &SetLineup{Points: 73.2, Matched: true}},
	}
	got, ok := StartSitOf(weeks)
	if !ok || got != (StartSit{Weeks: 3, Matched: 2, OursLessSet: 9.3}) {
		t.Fatalf("got %+v %v, want 3 weeks, 2 matched, 9.3", got, ok)
	}
}
