package leaguesync

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// memWeeks is the schedule store in memory.
type memWeeks struct {
	weeks map[int]KeptWeek
	puts  int
}

func (m *memWeeks) KeptWeeks(context.Context, Ref) ([]KeptWeek, error) {
	out := make([]KeptWeek, 0, len(m.weeks))
	for _, w := range m.weeks {
		out = append(out, w)
	}
	slices.SortFunc(out, func(a, b KeptWeek) int { return a.Week - b.Week })
	return out, nil
}

func (m *memWeeks) PutWeeks(_ context.Context, _ Ref, weeks []KeptWeek) error {
	m.puts++
	for _, w := range weeks {
		m.weeks[w.Week] = w
	}
	return nil
}

// weekReader answers each week asked: final before week 6, pairings after;
// fail makes every read fail.
type weekReader struct {
	Sleeper
	asked [][]int
	fail  bool
}

func (r *weekReader) ReadWeeks(_ context.Context, snap Snapshot, weeks []int) ([]ScheduledGame, error) {
	r.asked = append(r.asked, weeks)
	if r.fail {
		return nil, errors.New("host down")
	}
	var out []ScheduledGame
	for _, w := range weeks {
		g := ScheduledGame{Week: w, RosterIDs: []int{1, 2}, Final: playedBefore(snap, w)}
		if g.Final {
			g.Points = []float64{100, 90}
		}
		out = append(out, g)
	}
	return out, nil
}

// The keeper reads every week once into an empty store, then nothing while
// the played weeks are final and the pairings fresh; a day on, the weeks to
// come again and never a final week; a failed read holds for an hour and
// writes nothing; a host whose read carries its own schedule is left alone.
func TestTheScheduleKeeperReadsEachWeekOnceAndPairingsDaily(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	store := &memWeeks{weeks: map[int]KeptWeek{}}
	k := &ScheduleKeeper{Store: store, Now: func() time.Time { return now }, Go: func(f func()) { f() }}
	reader := &weekReader{}
	snap := Snapshot{Ref: Ref{Host: HostSleeper, LeagueID: "1"}, Week: 6, Status: StatusInSeason, Terms: Terms{PlayoffFirst: 15}}

	got := k.Fill(context.Background(), reader, snap)
	if len(got.Schedule) != 0 || len(reader.asked) != 1 || !slices.Equal(reader.asked[0], []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14}) {
		t.Fatalf("the first read asked %v and answered %d games", reader.asked, len(got.Schedule))
	}
	got = k.Fill(context.Background(), reader, snap)
	if len(got.Schedule) != 14 || len(reader.asked) != 1 {
		t.Fatalf("the second read asked %v and answered %d games", reader.asked, len(got.Schedule))
	}
	now = now.Add(25 * time.Hour)
	snap.Week = 7
	k.Fill(context.Background(), reader, snap)
	if want := []int{6, 7, 8, 9, 10, 11, 12, 13, 14}; len(reader.asked) != 2 || !slices.Equal(reader.asked[1], want) {
		t.Fatalf("a day on it asked %v, want week 6 (now played) and the weeks to come", reader.asked)
	}
	if !store.weeks[6].Final || store.weeks[5].ReadAt.After(store.weeks[1].ReadAt) {
		t.Fatal("week 6 is final now, week 5 was never read again")
	}

	now = now.Add(25 * time.Hour)
	reader.fail = true
	puts := store.puts
	k.Fill(context.Background(), reader, snap)
	k.Fill(context.Background(), reader, snap)
	if len(reader.asked) != 3 || store.puts != puts {
		t.Fatalf("a failed read is held: asked %d times, %d writes", len(reader.asked), store.puts-puts)
	}
	now = now.Add(time.Hour)
	k.Fill(context.Background(), reader, snap)
	if len(reader.asked) != 4 {
		t.Fatalf("after the hold the read is tried again: %d", len(reader.asked))
	}

	espnRead := Snapshot{Week: 6, Schedule: []ScheduledGame{{Week: 1, RosterIDs: []int{1, 2}}}}
	if out := k.Fill(context.Background(), &ESPN{}, espnRead); len(out.Schedule) != 1 {
		t.Fatal("ESPN's own schedule stands")
	}
	var none *ScheduleKeeper
	if out := none.Fill(context.Background(), reader, snap); out.Schedule != nil {
		t.Fatal("no keeper, no schedule")
	}
}

// A played week the host has not scored final is asked again within the
// hour, not every read.
func TestAnUnfinishedWeekIsAskedHourly(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	kept := map[int]KeptWeek{}
	for w := 1; w <= 14; w++ {
		kept[w] = KeptWeek{Week: w, Final: w < 6 && w != 3, ReadAt: now}
	}
	k := &ScheduleKeeper{Now: func() time.Time { return now }}
	snap := Snapshot{Week: 6, Terms: Terms{PlayoffFirst: 15}}
	list, _ := (&memWeeks{weeks: kept}).KeptWeeks(context.Background(), Ref{})
	if due := k.due(snap, list); len(due) != 0 {
		t.Fatalf("inside the hour: %v", due)
	}
	now = now.Add(time.Hour)
	if due := k.due(snap, list); !slices.Equal(due, []int{3}) {
		t.Fatalf("after the hour: %v", due)
	}
}

// The kept weeks are stored per league read and week: a second read of a
// week replaces its row (a corrected score retires the old one in the same
// transaction), other weeks stand, and a league no one has linked keeps
// nothing.
func TestTheScheduleStoreReplacesAWeekWhole(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	ref := Ref{Host: HostSleeper, LeagueID: "1382163311038038016"}
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	week := func(w int, points float64) KeptWeek {
		return KeptWeek{Week: w, Final: true, ReadAt: at, Games: []ScheduledGame{h2h(w, 1, 2, points, 90)}}
	}
	if err := store.PutWeeks(ctx, ref, []KeptWeek{week(1, 100)}); err != nil {
		t.Fatal(err)
	}
	if kept, _ := store.KeptWeeks(ctx, ref); len(kept) != 0 {
		t.Fatalf("an unlinked league kept %d weeks", len(kept))
	}
	if _, err := store.Save(ctx, Link{AccountID: alice.ID, Ref: ref, RosterID: 1}, true); err != nil {
		t.Fatal(err)
	}
	if err := store.PutWeeks(ctx, ref, []KeptWeek{week(1, 100), week(2, 101)}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutWeeks(ctx, ref, []KeptWeek{week(1, 104.5)}); err != nil {
		t.Fatal(err)
	}
	kept, err := store.KeptWeeks(ctx, ref)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 2 || kept[0].Games[0].Points[0] != 104.5 || len(kept[0].Games) != 1 || kept[1].Games[0].Points[0] != 101 || !kept[1].ReadAt.Equal(at) {
		t.Fatalf("kept %+v", kept)
	}
	other := ref
	other.As = alice.ID
	if k, _ := store.KeptWeeks(ctx, other); len(k) != 0 {
		t.Fatal("a member read is kept apart from the shared read")
	}
}
