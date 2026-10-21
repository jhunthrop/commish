package inseason

import (
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// LiveBoards keeps each board at the read's clock (RestAt, LiveBoard) for
// the clock's minute (Lane 112 ruling 3): the advice, the order and the
// front door's strip read one board of a run, horizon and minute, built
// once. A board of a new run, or a schedule read again, is a new key, so
// a run that changes is never served from the old one.
//
// The key also carries how many of the schedule's games have kicked off
// or are final at the clock. A rest of season reads the clock only
// through the one game state (gameStateAt), and for one schedule that
// count names the set of games past (a kickoff passes, never returns), so
// a board kept for the key is the board the request's own clock builds:
// a kickoff inside the minute is a new key, never a stale board.
//
// A nil *LiveBoards builds every board afresh.
type LiveBoards struct {
	// Log takes each build's duration (Lane 112 ruling 4); nil discards it.
	Log *slog.Logger

	mu     sync.Mutex
	minute int64
	kept   map[liveKey]*liveBuild
}

// liveKey is one board at one clock.
type liveKey struct {
	board    boards.Identity
	schedule *boards.TeamWeek
	games    int
	horizon  Horizon
	past     int
	minute   int64
}

// liveBuild is one board's build: done closes once board, rest and err
// are set.
type liveBuild struct {
	done  chan struct{}
	board boards.Board
	rest  RestNow
	err   error
}

// At is b at now through h (RestAt, LiveBoard), and the rest of season
// it was built from.
func (c *LiveBoards) At(b boards.Board, games []boards.TeamWeek, h Horizon, now time.Time) (boards.Board, RestNow, error) {
	if c == nil {
		return buildLive(b, games, h, now)
	}
	key := keyAt(b, games, h, now)
	build, owner := c.claim(key)
	if owner {
		c.build(key, build, b, games, h, now)
	}
	<-build.done
	return build.board, build.rest, build.err
}

// errUnbuilt answers the requests waiting on a build that never finished.
var errUnbuilt = errors.New("inseason: the board at the read's clock was not built")

// build runs the key's build for every request waiting on it and logs how
// long it took. A build that fails, or panics, is forgotten, so the next
// request builds again.
func (c *LiveBoards) build(key liveKey, build *liveBuild, b boards.Board, games []boards.TeamWeek, h Horizon, now time.Time) {
	start := time.Now()
	build.err = errUnbuilt
	defer func() {
		if build.err != nil {
			c.forget(key, build)
		}
		close(build.done)
	}()
	build.board, build.rest, build.err = buildLive(b, games, h, now)
	if build.err != nil {
		return
	}
	if c.Log != nil {
		c.Log.Info("inseason: live board build", "ms", time.Since(start).Milliseconds(), "from_week", b.FromWeek, "horizon", h.Last)
	}
}

func buildLive(b boards.Board, games []boards.TeamWeek, h Horizon, now time.Time) (boards.Board, RestNow, error) {
	rest := RestAt(games, b.FromWeek, b.Refreshed, now, h)
	live, err := LiveBoard(b, rest)
	return live, rest, err
}

func keyAt(b boards.Board, games []boards.TeamWeek, h Horizon, now time.Time) liveKey {
	key := liveKey{board: b.Identity(), games: len(games), horizon: h, minute: now.Truncate(time.Minute).Unix()}
	if len(games) > 0 {
		key.schedule = &games[0]
	}
	for _, g := range games {
		if gameStateAt(g, now) != apitypes.GameStateUpcoming {
			key.past++
		}
	}
	return key
}

// claim is the key's build, and whether the caller is to run it. A new
// minute drops the last minute's boards, so the cache holds one minute.
func (c *LiveBoards) claim(key liveKey) (*liveBuild, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.kept == nil || key.minute != c.minute {
		c.kept, c.minute = map[liveKey]*liveBuild{}, key.minute
	}
	if build, ok := c.kept[key]; ok {
		return build, false
	}
	build := &liveBuild{done: make(chan struct{})}
	c.kept[key] = build
	return build, true
}

// forget drops a failed build, so the next request builds again.
func (c *LiveBoards) forget(key liveKey, build *liveBuild) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.kept[key] == build {
		delete(c.kept, key)
	}
}
