package inseason

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// fixtureReads is the research store holding a fixture's season, each
// read counted.
type fixtureReads struct {
	data                    Data
	lines, games, facts, pj atomic.Int32
	weeks                   sync.Map
	fail                    bool
	block                   chan struct{}
}

func (r *fixtureReads) wait() error {
	if r.block != nil {
		<-r.block
	}
	if r.fail {
		return errors.New("store down")
	}
	return nil
}

func (r *fixtureReads) StatLines(context.Context, int) ([]boards.StatLine, error) {
	r.lines.Add(1)
	return r.data.Lines, r.wait()
}

func (r *fixtureReads) Schedule(context.Context, int) ([]boards.TeamWeek, error) {
	r.games.Add(1)
	return r.data.Games, r.wait()
}

func (r *fixtureReads) Designations(context.Context) (map[string]boards.Designation, error) {
	return r.data.Designations, r.wait()
}

func (r *fixtureReads) DesignationRuns(context.Context, time.Time) (map[boards.RunKey]time.Time, error) {
	return nil, r.wait()
}

func (r *fixtureReads) GameFacts(context.Context, int) (map[boards.ClubWeek]boards.GameFact, error) {
	r.facts.Add(1)
	return r.data.GameFacts, r.wait()
}

func (r *fixtureReads) WeekProjection(_ context.Context, _, week int) (boards.WeekProjection, error) {
	r.pj.Add(1)
	r.weeks.Store(week, true)
	return boards.WeekProjection{Week: week}, r.wait()
}

func warmService(t *testing.T, reads *fixtureReads, log *slog.Logger) (*Service, fixture, *atomic.Int32) {
	t.Helper()
	f := newFixture(t)
	reads.data = f.data
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = &Cache{Reads: reads, Now: func() time.Time { return fixtureNow }}
	s.Boards, s.Season, s.Log = &askingBoards{board: f.league.Board}, 2026, log
	builds := &atomic.Int32{}
	s.Lives = &LiveBoards{Log: slog.New(countedLines{Handler: slog.NewTextHandler(io.Discard, nil), message: "inseason: live board build", n: builds})}
	return s, f, builds
}

// The warm at start fills the season's reads, the week's projection and
// the next week's, and builds the run's board at the clock, so the first
// request reads none of them again (Lane 112 ruling 1).
func TestTheWarmAtStartFillsBeforeTheFirstRequest(t *testing.T) {
	reads := &fixtureReads{}
	var logged bytes.Buffer
	s, f, builds := warmService(t, reads, slog.New(slog.NewTextHandler(&logged, nil)))
	s.WarmAtStart(context.Background(), time.Second)
	if !strings.Contains(logged.String(), "inseason: warmed at start") {
		t.Fatalf("no warm line: %s", logged.String())
	}
	week := nextWeek(f.data.Games)
	for _, w := range []int{week, week + 1} {
		if _, ok := reads.weeks.Load(w); !ok && (w == week || hasGames(f.data.Games, w)) {
			t.Fatalf("week %d's projection not read at start", w)
		}
	}
	lines, games, facts, pj, built := reads.lines.Load(), reads.games.Load(), reads.facts.Load(), reads.pj.Load(), builds.Load()
	if lines != 1 || games != 1 || facts != 1 || built != 1 {
		t.Fatalf("at start: lines %d games %d facts %d builds %d", lines, games, facts, built)
	}
	if code, env := serve(t, s, "/order"); code != http.StatusOK || !env.Ok {
		t.Fatalf("/order %d %+v", code, env.Error)
	}
	if reads.lines.Load() != lines || reads.games.Load() != games || reads.facts.Load() != facts || reads.pj.Load() != pj || builds.Load() != built {
		t.Fatalf("the first request read again: lines %d games %d facts %d projections %d builds %d",
			reads.lines.Load(), reads.games.Load(), reads.facts.Load(), reads.pj.Load(), builds.Load())
	}
}

// A warm whose reads fail logs and lets the service start; the first
// request fills as before.
func TestAFailedWarmLetsTheServiceStart(t *testing.T) {
	reads := &fixtureReads{fail: true}
	var logged bytes.Buffer
	s, _, _ := warmService(t, reads, slog.New(slog.NewTextHandler(&logged, nil)))
	s.WarmAtStart(context.Background(), time.Second)
	if !strings.Contains(logged.String(), "the warm at start failed") {
		t.Fatalf("no failure line: %s", logged.String())
	}
	reads.fail = false
	if code, env := serve(t, s, "/order"); code != http.StatusOK || !env.Ok {
		t.Fatalf("/order after a failed warm %d %+v", code, env.Error)
	}
}

// A warm that runs past its bound lets the service start at the bound.
func TestTheWarmAtStartIsBounded(t *testing.T) {
	reads := &fixtureReads{block: make(chan struct{})}
	defer close(reads.block)
	var logged bytes.Buffer
	s, _, _ := warmService(t, reads, slog.New(slog.NewTextHandler(&logged, nil)))
	start := time.Now()
	s.WarmAtStart(context.Background(), 50*time.Millisecond)
	if took := time.Since(start); took > time.Second {
		t.Fatalf("the warm held the start %v", took)
	}
	if !strings.Contains(logged.String(), "ran past its bound") {
		t.Fatalf("no bound line: %s", logged.String())
	}
}
