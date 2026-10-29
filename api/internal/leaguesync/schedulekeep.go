package leaguesync

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// The schedule keeper (Lane 298, B292): Sleeper, Yahoo and MyFantasyLeague
// carry no season schedule in a league's read, so each week's games are
// read apart and kept (app.league_schedule_weeks). A played week is read
// once it is final and never again on Sleeper and Yahoo; the weeks to come
// are read once a day for their pairings; a week the host has not finished
// scoring is asked again at most hourly; a failed read is held for an hour
// before the next try. All of it runs behind a read that landed, never on
// a viewer's request: the read answers the weeks already kept.
const (
	// pairingsEvery is how often the weeks to come are read again.
	pairingsEvery = 24 * time.Hour
	// unfinishedEvery is how often a past week the host has not scored
	// final is asked again.
	unfinishedEvery = time.Hour
	// failedHold is how long a failed schedule read is held before the
	// next try.
	failedHold = time.Hour
)

// ScheduleReader is a host whose league read leaves out the season's
// schedule: its weeks are read apart. A host that answers its whole
// schedule in one request (MyFantasyLeague) answers every week it has,
// whatever weeks are asked.
type ScheduleReader interface {
	ReadWeeks(ctx context.Context, snap Snapshot, weeks []int) ([]ScheduledGame, error)
}

// KeptWeek is one week of a league's schedule as kept: its games, whether
// the host had scored it final, and when it was read.
type KeptWeek struct {
	Week   int
	Games  []ScheduledGame
	Final  bool
	ReadAt time.Time
}

// ScheduleStore keeps the weeks read. PutWeeks replaces each week it is
// given in one transaction and keeps nothing for a league no account has
// linked. *Store implements it.
type ScheduleStore interface {
	KeptWeeks(ctx context.Context, ref Ref) ([]KeptWeek, error)
	PutWeeks(ctx context.Context, ref Ref, weeks []KeptWeek) error
}

// ScheduleKeeper fills a read's schedule from the kept weeks and reads the
// weeks it lacks behind the read.
type ScheduleKeeper struct {
	Store ScheduleStore
	Now   func() time.Time
	Log   *slog.Logger
	// Go runs a refresh behind the read: a new goroutine when nil. A test
	// runs it in place.
	Go func(func())

	mu      sync.Mutex
	running map[string]bool
	failed  map[string]time.Time
}

// Fill is the read with its schedule from the kept weeks, and the weeks
// it lacks read behind it. A host whose read carries its own schedule, or
// that reads none, is left as it is; a kept-weeks read that fails leaves
// the read without a schedule (logged).
func (k *ScheduleKeeper) Fill(ctx context.Context, host Host, snap Snapshot) Snapshot {
	reader, ok := host.(ScheduleReader)
	if !ok || k == nil || snap.Week == 0 {
		return snap
	}
	kept, err := k.Store.KeptWeeks(ctx, snap.Ref)
	if err != nil {
		k.warn("leaguesync: kept schedule", "league", snap.Ref.Key(), "err", err)
		return snap
	}
	snap.Schedule = scheduleOf(kept)
	if weeks := k.due(snap, kept); len(weeks) > 0 {
		k.refresh(reader, snap, weeks)
	}
	return snap
}

// scheduleOf is the kept weeks' games, in order.
func scheduleOf(kept []KeptWeek) []ScheduledGame {
	var out []ScheduledGame
	for _, w := range kept {
		out = append(out, w.Games...)
	}
	return sortSchedule(out)
}

// RegularSeasonLast is the league's last regular-season week: the week
// before its playoffs, or the regular season the host states without
// them; 0 where the host states neither.
func RegularSeasonLast(snap Snapshot) int {
	switch {
	case snap.Terms.PlayoffFirst > 1:
		return snap.Terms.PlayoffFirst - 1
	case snap.Calendar.PlayoffStartWeek > 1:
		return snap.Calendar.PlayoffStartWeek - 1
	}
	return snap.Calendar.RegularSeasonLast
}

// due is the weeks the keeper reads now, in order: each played week not
// kept final (one asked inside unfinishedEvery waits), and every week to
// come through the regular season's last when one is missing or the
// oldest was read more than pairingsEvery ago. Nothing while a failed read
// is held.
func (k *ScheduleKeeper) due(snap Snapshot, kept []KeptWeek) []int {
	now := k.now()
	if k.held(snap.Ref.Key(), now) {
		return nil
	}
	last := RegularSeasonLast(snap)
	if last == 0 {
		last = snap.Week
	}
	byWeek := make(map[int]KeptWeek, len(kept))
	for _, w := range kept {
		byWeek[w.Week] = w
	}
	played := snap.Week
	if snap.Status == StatusComplete {
		played = last + 1
	}
	var out []int
	for week := 1; week < played && week <= last; week++ {
		w, ok := byWeek[week]
		if !ok || (!w.Final && now.Sub(w.ReadAt) >= unfinishedEvery) {
			out = append(out, week)
		}
	}
	var ahead []int
	stale := false
	for week := max(played, 1); week <= last; week++ {
		ahead = append(ahead, week)
		w, ok := byWeek[week]
		stale = stale || !ok || now.Sub(w.ReadAt) >= pairingsEvery
	}
	if stale {
		out = append(out, ahead...)
	}
	return out
}

// held reports a failed read of the league inside failedHold.
func (k *ScheduleKeeper) held(key string, now time.Time) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	at, ok := k.failed[key]
	return ok && now.Sub(at) < failedHold
}

// refresh reads the weeks behind the read, one refresh per league at a
// time.
func (k *ScheduleKeeper) refresh(reader ScheduleReader, snap Snapshot, weeks []int) {
	key := snap.Ref.Key()
	k.mu.Lock()
	if k.running == nil {
		k.running, k.failed = map[string]bool{}, map[string]time.Time{}
	}
	if k.running[key] {
		k.mu.Unlock()
		return
	}
	k.running[key] = true
	k.mu.Unlock()
	run := func() {
		defer func() {
			k.mu.Lock()
			delete(k.running, key)
			k.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), ReadTimeout)
		defer cancel()
		if err := k.Read(ctx, reader, snap, weeks); err != nil {
			k.mu.Lock()
			k.failed[key] = k.now()
			k.mu.Unlock()
			k.warn("leaguesync: schedule read", "league", key, "weeks", weeks, "err", err)
		}
	}
	if k.Go == nil {
		go run()
		return
	}
	k.Go(run)
}

// Read reads the weeks from the host and keeps every week it answered,
// each week's row replaced whole.
func (k *ScheduleKeeper) Read(ctx context.Context, reader ScheduleReader, snap Snapshot, weeks []int) error {
	games, err := reader.ReadWeeks(ctx, snap, weeks)
	if err != nil {
		return err
	}
	return k.Store.PutWeeks(ctx, snap.Ref, keptOf(games, k.now()))
}

// keptOf groups games by week; a week is final when every game in it is.
func keptOf(games []ScheduledGame, at time.Time) []KeptWeek {
	byWeek := map[int]*KeptWeek{}
	for _, g := range games {
		w, ok := byWeek[g.Week]
		if !ok {
			w = &KeptWeek{Week: g.Week, Final: true, ReadAt: at}
			byWeek[g.Week] = w
		}
		w.Games = append(w.Games, g)
		w.Final = w.Final && g.Final
	}
	out := make([]KeptWeek, 0, len(byWeek))
	for _, w := range byWeek {
		out = append(out, *w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Week < out[j].Week })
	return out
}

func (k *ScheduleKeeper) warn(msg string, args ...any) {
	if k.Log != nil {
		k.Log.Warn(msg, args...)
	}
}

func (k *ScheduleKeeper) now() time.Time {
	if k.Now == nil {
		return time.Now()
	}
	return k.Now()
}
