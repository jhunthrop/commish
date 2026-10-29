package leaguesync

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// The Lane 298 fix round's tests (review lane-298-review.md): divisions
// (H1), the keeper's empty weeks and start week (M2), its unfinished
// answers (M1), standings against the schedule (M3) and partial reads (M4).

// scriptedReader answers each week from its script: games per week (an
// absent week is answered with none), failing after failAfter weeks when
// set.
type scriptedReader struct {
	Sleeper
	weeks     map[int][]ScheduledGame
	failAfter int
	asked     [][]int
}

func (r *scriptedReader) ReadWeeks(_ context.Context, _ Snapshot, weeks []int) ([]ScheduledGame, error) {
	r.asked = append(r.asked, weeks)
	var out []ScheduledGame
	for i, w := range weeks {
		if r.failAfter > 0 && i >= r.failAfter {
			return out, errors.New("host busy")
		}
		out = append(out, r.weeks[w]...)
	}
	return out, nil
}

func keeperAt(now *time.Time) (*ScheduleKeeper, *memWeeks) {
	store := &memWeeks{weeks: map[int]KeptWeek{}}
	return &ScheduleKeeper{Store: store, Now: func() time.Time { return *now }, Go: func(f func()) { f() }}, store
}

// M2: a week the platform answers with no games is kept with none, not
// final, and asked again only hourly, never on every read; the league's
// start week is where the schedule begins.
func TestAWeekAnsweredEmptyIsHeldAndTheStartWeekRead(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	k, store := keeperAt(&now)
	reader := &scriptedReader{weeks: map[int][]ScheduledGame{}}
	for w := 4; w <= 8; w++ {
		if w != 5 {
			reader.weeks[w] = []ScheduledGame{h2h(w, 1, 2, 100, 90)}
		}
	}
	snap := Snapshot{Ref: Ref{Host: HostSleeper, LeagueID: "1"}, Week: 7, Terms: Terms{PlayoffFirst: 9, StartWeek: 4}}
	k.Fill(context.Background(), reader, snap)
	if !slices.Equal(reader.asked[0], []int{4, 5, 6, 7, 8}) {
		t.Fatalf("asked %v, want the weeks from the start week", reader.asked[0])
	}
	if w, ok := store.weeks[5]; !ok || len(w.Games) != 0 || w.Final {
		t.Fatalf("week 5 kept as %+v, want kept empty and not final", w)
	}
	k.Fill(context.Background(), reader, snap)
	now = now.Add(30 * time.Minute)
	k.Fill(context.Background(), reader, snap)
	if len(reader.asked) != 1 {
		t.Fatalf("an empty week inside the hour is held: asked %v", reader.asked)
	}
	now = now.Add(31 * time.Minute)
	k.Fill(context.Background(), reader, snap)
	if len(reader.asked) != 2 || !slices.Equal(reader.asked[1], []int{5}) {
		t.Fatalf("after the hour only the empty week: %v", reader.asked)
	}
	if !covers(scheduleOf([]KeptWeek{store.weeks[4], store.weeks[6]}), 6, 6) || covers(scheduleOf([]KeptWeek{store.weeks[4]}), 4, 5) {
		t.Fatal("covers reads the season from its first week")
	}
}

// M1: a week answered final with every side at 0 is an unfinished answer,
// kept as pairings and not final.
func TestAFinalWeekAllAtZeroIsNotFinal(t *testing.T) {
	read := keptOf([]ScheduledGame{h2h(3, 1, 2, 0, 0), h2h(3, 3, 4, 0, 0)}, time.Now())
	if read[0].Final || read[0].Games[0].Scored() || read[0].Games[0].Final {
		t.Fatalf("%+v", read[0])
	}
	read = keptOf([]ScheduledGame{h2h(3, 1, 2, 0, 0), h2h(3, 3, 4, 0, 88.2)}, time.Now())
	if !read[0].Final {
		t.Fatal("one side scored: final")
	}
}

// M4: a read that fails partway keeps the weeks it read, holds the league,
// and the next read asks only what is still missing.
func TestAPartialReadKeepsWhatItRead(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	k, store := keeperAt(&now)
	reader := &scriptedReader{weeks: map[int][]ScheduledGame{}, failAfter: 2}
	for w := 1; w <= 4; w++ {
		reader.weeks[w] = []ScheduledGame{h2h(w, 1, 2, 100, 90)}
	}
	snap := Snapshot{Ref: Ref{Host: HostYahoo, LeagueID: "1"}, Week: 5, Terms: Terms{PlayoffFirst: 5}}
	k.Fill(context.Background(), reader, snap)
	if len(store.weeks) != 2 || store.weeks[1].Games == nil || store.weeks[2].Games == nil {
		t.Fatalf("kept %v, want weeks 1 and 2 read before the failure", store.weeks)
	}
	if _, ok := store.weeks[3]; ok {
		t.Fatal("a week not answered is not kept as empty")
	}
	k.Fill(context.Background(), reader, snap)
	if len(reader.asked) != 1 {
		t.Fatal("the failure holds")
	}
	now = now.Add(time.Hour)
	reader.failAfter = 0
	k.Fill(context.Background(), reader, snap)
	if !slices.Equal(reader.asked[1], []int{3, 4}) {
		t.Fatalf("after the hold %v, want the weeks still missing", reader.asked[1])
	}
}

// M3: the standings win. A schedule that has scored a week the standings
// do not count yet, or not scored a week they count, disagrees from that
// week; the keeper reads it again inside disagreeEvery, and no chance is
// reckoned on it.
func TestStandingsAgainstTheSchedule(t *testing.T) {
	snap := syntheticLeague()
	if Disagreement(snap, snap.Schedule) != 0 {
		t.Fatal("the synthetic league agrees")
	}
	ahead := append([]ScheduledGame(nil), snap.Schedule...)
	ahead[6], ahead[7] = h2h(4, 1, 4, 100, 99), h2h(4, 2, 3, 90, 140)
	if got := Disagreement(snap, ahead); got != 4 {
		t.Fatalf("a schedule ahead of the standings disagrees from week %d, want 4", got)
	}
	if _, ok := PlayoffChances(Snapshot{Ref: snap.Ref, Week: 5, Teams: snap.Teams, Schedule: ahead, Terms: snap.Terms}); ok {
		t.Fatal("no figure on a schedule that disagrees")
	}
	behind := append([]ScheduledGame(nil), snap.Schedule...)
	behind[4], behind[5] = ahead2(3, 1, 2), ahead2(3, 3, 4)
	if got := Disagreement(snap, behind); got != 3 {
		t.Fatalf("a schedule behind the standings disagrees from week %d, want 3", got)
	}
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	k, _ := keeperAt(&now)
	var kept []KeptWeek
	for _, w := range keptOf(ahead, now.Add(-20*time.Minute)) {
		w.Confirmed = w.Final
		kept = append(kept, w)
	}
	snap.Week = 5
	if due := k.due(snap, kept); !slices.Equal(due, []int{4}) {
		t.Fatalf("due %v, want week 4 read again", due)
	}
}

// H1: a league of several divisions whose seating is not read proves
// nothing: no 100 and no 0, even with no game left, and the sentence says
// so; a league whose divisions are not read at all, the same.
func TestDivisionsNotReadHoldEveryProof(t *testing.T) {
	for name, terms := range map[string]Terms{
		"several divisions, seating unread": {PlayoffTeams: 2, PlayoffFirst: 5, DivisionsRead: true, Divisions: 2, Tiebreak: TiebreakPointsFor},
		"divisions unread":                  {PlayoffTeams: 2, PlayoffFirst: 5, Tiebreak: TiebreakPointsFor},
	} {
		snap := settledLeague()
		snap.Terms = terms
		c, ok := PlayoffChances(snap)
		if !ok {
			t.Fatalf("%s: no figure", name)
		}
		for id, pct := range c.ByRoster {
			if pct == 0 || pct == 100 {
				t.Fatalf("%s: team %d reads %d", name, id, pct)
			}
		}
		if !strings.HasSuffix(c.Basis, "Divisions are not counted, so no team reads 100 or 0.") {
			t.Fatalf("%s: %q", name, c.Basis)
		}
	}
	snap := settledLeague()
	snap.Terms = Terms{PlayoffTeams: 2, PlayoffFirst: 5, DivisionsRead: true, Divisions: 1, Tiebreak: TiebreakPointsFor}
	if c, _ := PlayoffChances(snap); c.ByRoster[1] != 100 || c.ByRoster[4] != 0 {
		t.Fatalf("one division proves as before: %v", c.ByRoster)
	}
}

// divisionLeague is six teams in two divisions with three seats, each
// division's winner seated, the season over: division 1 is A 9-3, B 8-4,
// C 7-5; division 2 is D 4-8, E 3-9, F 3-9.
func divisionLeague() chanceLeague {
	l := chanceLeague{
		ids:      []int{1, 2, 3, 4, 5, 6},
		wins:     map[int]float64{1: 9, 2: 8, 3: 7, 4: 4, 5: 3, 6: 3},
		points:   map[int]float64{1: 1500, 2: 1480, 3: 1490, 4: 1200, 5: 1300, 6: 1250},
		seeds:    []string{SeedRecord, SeedRecord, SeedRecord},
		division: map[int]int{1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2},
		tieRule:  TiebreakPointsFor,
	}
	return l
}

// H1: where division winners are seated, the 4-8 leader of the weak
// division is in (overall record would read it 0) and the 7-5 third of the
// strong one is out (overall record would seat it); the replay seats the
// same field; mid-season nothing is proven by overall record.
func TestDivisionWinnersAreSeated(t *testing.T) {
	l := divisionLeague()
	clinched, out := l.proofs()
	if !clinched[4] || !clinched[1] || !clinched[2] || !out[3] || !out[5] || !out[6] {
		t.Fatalf("settled with division winners: clinched %v, out %v", clinched, out)
	}
	if got := l.field(l.wins, l.points); !slices.Equal(got, []int{1, 4, 2}) {
		t.Fatalf("the replay's field %v, want A and D the winners, then B", got)
	}
	l.weeks = [][]chanceGame{{{rosters: []int{1, 4}}, {rosters: []int{2, 5}}, {rosters: []int{3, 6}}}}
	clinched, out = l.proofs()
	for _, id := range l.ids {
		if clinched[id] || out[id] {
			t.Fatalf("mid-season, a divisional league proves nothing: %v %v", clinched, out)
		}
	}
	// A tie for a division's lead under an unread rule leaves both open.
	l = divisionLeague()
	l.tieRule = ""
	l.wins[5] = 4
	clinched, out = l.proofs()
	if clinched[4] || out[4] || clinched[5] || out[5] || !clinched[1] {
		t.Fatalf("a tie for the lead is open: %v %v", clinched, out)
	}
	snap := settledLeague()
	snap.Terms = Terms{PlayoffTeams: 3, PlayoffFirst: 5, DivisionsRead: true, Divisions: 2, DivisionWinners: true}
	if b := chanceBasis(snap); !strings.Contains(b, "Each division's winner makes it, then the top 3 by record make it.") {
		t.Fatalf("%q", b)
	}
}

// H1: the platforms' divisions as read: ESPN's list (the recorded league,
// one division), Sleeper's settings.divisions, Yahoo's division_id on
// each team.
func TestDivisionsAsRead(t *testing.T) {
	espnSnap := espnSnapshot(espnFixtureRead(t), time.Now())
	if !espnSnap.Terms.DivisionsRead || espnSnap.Terms.Divisions != 1 {
		t.Fatalf("ESPN %+v", espnSnap.Terms)
	}
	if got := sleeperTerms(sleeper.League{Divisions: 2, StartWeek: 3}); !got.DivisionsRead || got.Divisions != 2 || got.StartWeek != 3 {
		t.Fatalf("Sleeper %+v", got)
	}
	if divisionsOf([]Team{{Division: 1}, {Division: 2}, {Division: 1}}) != 2 || divisionsOf([]Team{{}, {}}) != 0 {
		t.Fatal("Yahoo's divisions")
	}
}
