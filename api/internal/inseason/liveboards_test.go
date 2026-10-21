package inseason

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

func livePointsOf(t *testing.T, b boards.Board, id string) float64 {
	t.Helper()
	p, ok := b.Player(id)
	if !ok || p.Points == nil {
		t.Fatalf("no points for %s", id)
	}
	return *p.Points
}

// One run, horizon and minute is one build, shared by every request in
// the minute, at once or after (Lane 112 ruling 3), and it is the board
// a build of its own would answer.
func TestLiveBoardsBuildOncePerRunHorizonAndMinute(t *testing.T) {
	c := &LiveBoards{}
	b, games := restRunBoard(t), restWeekSix(true, false)
	at := restSunday.Add(5 * time.Hour)
	var wg sync.WaitGroup
	raws := make([]*boards.Raw, 8)
	for i := range raws {
		wg.Add(1)
		go func() {
			defer wg.Done()
			live, _, err := c.At(b, games, StandardHorizon, at.Add(time.Duration(i)*time.Second))
			if err != nil {
				t.Error(err)
				return
			}
			raws[i] = live.Raw
		}()
	}
	wg.Wait()
	for i, raw := range raws {
		if raw == nil || raw != raws[0] {
			t.Fatalf("request %d read its own build", i)
		}
	}
	kept, rest, err := c.At(b, games, StandardHorizon, at.Add(30*time.Second))
	if err != nil || kept.Raw != raws[0] {
		t.Fatalf("a later request in the minute built again (%v)", err)
	}
	own, ownRest, err := (*LiveBoards)(nil).At(b, games, StandardHorizon, at)
	if err != nil {
		t.Fatal(err)
	}
	if livePointsOf(t, kept, "mia") != livePointsOf(t, own, "mia") || livePointsOf(t, kept, "mia") != 110 ||
		rest.Left["MIA"] != ownRest.Left["MIA"] || rest.Partial != ownRest.Partial {
		t.Fatalf("the kept board differs from its own build: %v against %v", livePointsOf(t, kept, "mia"), livePointsOf(t, own, "mia"))
	}
}

// A new minute, another horizon, a new run of the board and a schedule
// read again each build their own.
func TestLiveBoardsBuildAgainForANewKey(t *testing.T) {
	c := &LiveBoards{}
	b, games := restRunBoard(t), restWeekSix(true, false)
	at := restSunday.Add(5 * time.Hour)
	first, _, err := c.At(b, games, StandardHorizon, at)
	if err != nil {
		t.Fatal(err)
	}
	for name, read := range map[string]func() (boards.Board, RestNow, error){
		"next minute":  func() (boards.Board, RestNow, error) { return c.At(b, games, StandardHorizon, at.Add(time.Minute)) },
		"horizon":      func() (boards.Board, RestNow, error) { return c.At(b, games, Horizon{Last: 16}, at) },
		"new run":      func() (boards.Board, RestNow, error) { return c.At(restRunBoard(t), games, StandardHorizon, at) },
		"schedule":     func() (boards.Board, RestNow, error) { return c.At(b, restWeekSix(true, false), StandardHorizon, at) },
		"another club": func() (boards.Board, RestNow, error) { return c.At(b, games[:len(games)-2], StandardHorizon, at) },
	} {
		live, _, err := read()
		if err != nil {
			t.Fatal(err)
		}
		if live.Raw == first.Raw {
			t.Fatalf("%s: served the kept board", name)
		}
	}
}

// A kickoff inside the minute is a new key: the request after it reads
// the game under way, the request before it the game to play, each as its
// own clock says.
func TestLiveBoardsTurnAtAKickoffInsideTheMinute(t *testing.T) {
	c := &LiveBoards{}
	b := restRunBoard(t)
	games := restWeekSix(false, false)
	kickoff := restSunday.Add(30 * time.Second)
	for i := range games {
		if games[i].Week == 6 && (games[i].Team == "MIA" || games[i].Team == "NE") {
			games[i].Kickoff = kickoff
		}
	}
	before, restBefore, err := c.At(b, games, StandardHorizon, kickoff.Add(-20*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	after, restAfter, err := c.At(b, games, StandardHorizon, kickoff.Add(10*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if livePointsOf(t, before, "mia") != 120 || restBefore.Partial {
		t.Fatalf("before the kickoff: %v partial %v", livePointsOf(t, before, "mia"), restBefore.Partial)
	}
	if livePointsOf(t, after, "mia") != 110 || !restAfter.Partial {
		t.Fatalf("after the kickoff: %v partial %v", livePointsOf(t, after, "mia"), restAfter.Partial)
	}
}

// A minute's boards go when the next minute's first is built: the cache
// holds one minute.
func TestLiveBoardsHoldOneMinute(t *testing.T) {
	c := &LiveBoards{}
	b, games := restRunBoard(t), restWeekSix(true, false)
	at := restSunday.Add(5 * time.Hour)
	for _, h := range []Horizon{StandardHorizon, {Last: 16}, {Last: 15}} {
		if _, _, err := c.At(b, games, h, at); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := c.At(b, games, StandardHorizon, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.kept) != 1 {
		t.Fatalf("%d boards kept, want the minute's one", len(c.kept))
	}
}

// countedLines counts the log lines with one message.
type countedLines struct {
	slog.Handler
	message string
	n       *atomic.Int32
}

func (h countedLines) Handle(ctx context.Context, r slog.Record) error {
	if r.Message == h.message {
		h.n.Add(1)
	}
	return h.Handler.Handle(ctx, r)
}

// The league's screens and its order read one board at the read's clock:
// one build for the minute, logged once with its duration.
func TestTheLeagueScreensShareOneLiveBoard(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	builds := &atomic.Int32{}
	s.Lives = &LiveBoards{Log: slog.New(countedLines{Handler: slog.NewTextHandler(io.Discard, nil), message: "inseason: live board build", n: builds})}
	for _, route := range []string{"lineup", "matchup", "waivers", "order", "trades"} {
		if code, env := serve(t, s, leaguePath+route); code != http.StatusOK || !env.Ok {
			t.Fatalf("%s: %d %+v", route, code, env.Error)
		}
	}
	if n := builds.Load(); n != 1 {
		t.Fatalf("five screens built the live board %d times, want once", n)
	}
}
