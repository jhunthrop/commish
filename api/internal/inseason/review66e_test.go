package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// The season's figures a Lineup row shows beside his projection (Lane
// 66e): the opponent's rank against his position, none on a bye; his
// points a game and his last game's, newest first.
func TestEvidenceFromTheWeeksFacts(t *testing.T) {
	avg := 14.256
	f := Facts{Allowed: &Allowed{Rank: 24, Of: 32}, PerGame: &avg, LastGames: []GamePoints{{Week: 5, Points: 21.944}, {Week: 4, Points: 9}}}
	rank, season, last := evidence(f)
	if rank == nil || *rank != 24 || season == nil || *season != 14.26 || last == nil || *last != 21.94 {
		t.Fatalf("rank %v avg %v last %v", deref(intPtr(rank)), deref(season), deref(last))
	}
	f.Bye = true
	if rank, _, _ := evidence(f); rank != nil {
		t.Fatal("a bye has no opponent to rank")
	}
	if rank, season, last := evidence(Facts{}); rank != nil || season != nil || last != nil {
		t.Fatal("nothing held, nothing shown")
	}
}

func intPtr(p *int) *float64 {
	if p == nil {
		return nil
	}
	v := float64(*p)
	return &v
}

// The Lineup answer carries the change since the snapshot before and when
// it was read, the players in the injured reserve spots, the basis the
// advice follows, and a change's sentence on the Proj the screen shows.
func TestLineupCarriesTheProjectionsChangeAndTheReserve(t *testing.T) {
	f := newFixture(t)
	team, _ := f.league.Snap.TeamByRoster(1)
	// The bench's last player sits in an injured reserve spot.
	reserved := team.Players[len(team.Players)-1]
	for i := range f.league.Snap.Teams {
		if f.league.Snap.Teams[i].RosterID == 1 {
			f.league.Snap.Teams[i].Reserve = []string{reserved}
		}
	}
	// The bench quarterback's projection beats the starter's.
	qb := *f.league.Player(team.Starters[0]).BoardId
	var benchQB string
	for _, h := range team.Players[10:] {
		if p := f.league.Player(h); p.Position == "QB" && h != reserved {
			benchQB = *p.BoardId
		}
	}
	if benchQB == "" {
		t.Skip("the fixture roster has no bench quarterback")
	}
	before := time.Date(2026, 10, 15, 13, 0, 0, 0, time.UTC)
	newest := time.Date(2026, 10, 17, 2, 0, 0, 0, time.UTC)
	proj := boards.WeekProjection{Week: 6, ReadAt: newest,
		Players: map[string]boards.ProjectedPoints{qb: {PPR: 16.8}, benchQB: {PPR: 18.5}},
		Previous: &boards.WeekProjection{Week: 6, ReadAt: before,
			Players: map[string]boards.ProjectedPoints{qb: {PPR: 17.1}, benchQB: {PPR: 18.1}}}}
	a, err := newAdvisor(f.league, f.data, proj, nil, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := a.Lineup()
	if got.ProjectionPreviousReadAt == nil || !got.ProjectionPreviousReadAt.Equal(before) {
		t.Fatalf("the read before: %v", got.ProjectionPreviousReadAt)
	}
	if len(got.Reserve) != 1 || got.Reserve[0].Player.HostId != reserved {
		t.Fatalf("the reserve: %+v", got.Reserve)
	}
	for _, line := range got.Bench {
		if line.Player.HostId == reserved {
			t.Fatal("a reserve player on the bench")
		}
	}
	qbSlot := got.Slots[0]
	if !qbSlot.Changed || qbSlot.Ours.Player.BoardId == nil || *qbSlot.Ours.Player.BoardId != benchQB {
		t.Fatalf("the higher Proj starts: %+v", qbSlot)
	}
	if d := qbSlot.Ours.ProjectionDelta; d == nil || *d != 0.4 {
		t.Fatalf("the change since the read before: %v", deref(d))
	}
	if d := qbSlot.Host.ProjectionDelta; d == nil || *d != -0.3 {
		t.Fatalf("the sat starter's change: %v", deref(d))
	}
	if qbSlot.Sentence == nil || !strings.Contains(*qbSlot.Sentence, "has 18.5 Proj this week against") || !strings.Contains(*qbSlot.Sentence, "'s 16.8.") {
		t.Fatalf("the sentence argues the Proj: %v", qbSlot.Sentence)
	}
	if !strings.HasPrefix(got.Basis, "We start the highest Proj at each slot") {
		t.Fatalf("basis %q", got.Basis)
	}
	for _, line := range append(got.Bench, got.Reserve...) {
		if line.WeekProjection == nil && line.ProjectionDelta != nil {
			t.Fatalf("a change with no projection: %+v", line)
		}
	}
}

// Through the advisor with a real bye (Lane 66e review M5, L10): the
// fixture's last two clubs have no game in week 6, so their players have
// no opponent and no Proj. None is ever advised into a spot; a spot whose
// every eligible player is on bye keeps the member's player, marked, with
// no change.
func TestAByeNeverStartsThroughTheAdvisor(t *testing.T) {
	f := newFixture(t)
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := a.Lineup()
	byeStarters, marked := 0, 0
	for _, s := range got.Slots {
		if s.Ours.Facts.Bye && s.Ours.WeekProjection != nil {
			t.Fatalf("a bye with a Proj: %s", s.Ours.Player.Name)
		}
		if s.Host != nil && s.Host.Facts.Bye {
			byeStarters++
		}
		if !s.Ours.Facts.Bye {
			continue
		}
		if s.Changed || !s.NoOneCanPlay {
			t.Fatalf("a player on bye advised into %s: %+v", s.Slot, s.Ours.Player)
		}
		marked++
	}
	if byeStarters == 0 {
		t.Fatal("the fixture's lineup holds no starter on bye: the test proves nothing")
	}
	t.Logf("%d starters on bye in the set lineup, %d spots no one can play", byeStarters, marked)
}
