// Command companionsmoke is the live-draft companion's measurement (Lane
// 8): the recorded 2026 Sleeper draft (internal/companion/replay) driven
// through the companion's own parts against a local board.
//
//   - Poll cost: VIEWERS browsers each asking every 3 s for SECONDS
//     against one draft, through the Poller, counting the reads that
//     reach the host. The discipline is one read per draft per 2 s.
//   - Placement: every recorded pick matched to our board by exact name,
//     by the folded name, or left unplaced.
//   - The replay: the draft rebuilt after every pick as the page asks for
//     it, timing each rebuild and the card at each of the drafter's turns
//     from the engine (the fallback the advisor stands in front of).
//
// go run ./tools/companionsmoke -db postgres://commish:commish@localhost:5432/commish -slot 5
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/companion"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sim"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// fixtureHost answers the Poller from the recording, counting reads.
type fixtureHost struct {
	replay companion.Replay
	reads  atomic.Int64
}

func (h *fixtureHost) Draft(context.Context, string) (sleeper.Draft, error) {
	h.reads.Add(1)
	return h.replay.Draft, nil
}

func (h *fixtureHost) Picks(context.Context, string, int, int) ([]sleeper.Pick, error) {
	return h.replay.Picks, nil
}

func main() {
	dbURL := flag.String("db", "", "the local database holding the research board")
	slot := flag.Int("slot", 5, "the drafter's slot")
	viewers := flag.Int("viewers", 25, "browsers polling one draft")
	seconds := flag.Int("seconds", 30, "how long they poll")
	flag.Parse()
	if err := run(*dbURL, *slot, *viewers, *seconds); err != nil {
		fmt.Fprintln(os.Stderr, "companionsmoke:", err)
		os.Exit(1)
	}
}

func run(dbURL string, slot, viewers, seconds int) error {
	replay, err := companion.LoadReplay()
	if err != nil {
		return err
	}
	pollCost(replay, viewers, seconds)
	pool, err := db.Open(dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	ctx := context.Background()
	boardSource, _, err := draftroom.OpenBoards(pool, config.Board{Schema: "research", Season: 2026, SourcePrefix: "commish_board_v9", TTL: time.Hour}, time.Now)
	if err != nil {
		return err
	}
	settings, err := companion.SettingsFor(replay.Draft, &replay.League, slot)
	if err != nil {
		return err
	}
	board, err := boardSource.For(ctx, settings)
	if err != nil {
		return err
	}
	placement(replay, board.Raw)
	return walk(ctx, replay, slot, settings, board)
}

func pollCost(replay companion.Replay, viewers, seconds int) {
	host := &fixtureHost{replay: replay}
	poller := &companion.Poller{Host: host, Now: time.Now}
	deadline := time.Now().Add(time.Duration(seconds) * time.Second)
	var asked atomic.Int64
	var wg sync.WaitGroup
	for v := range viewers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Viewers arrive spread across one poll interval, as browsers do.
			time.Sleep(time.Duration(v) * 3 * time.Second / time.Duration(viewers))
			for time.Now().Before(deadline) {
				_, _ = poller.Read(context.Background(), companion.ReplayDraftID)
				asked.Add(1)
				time.Sleep(3 * time.Second)
			}
		}()
	}
	wg.Wait()
	fmt.Printf("poll cost: %d viewers asked %d times in %d s, %d reads reached the host (%.2f a second, the cap is 0.5)\n",
		viewers, asked.Load(), seconds, host.reads.Load(), float64(host.reads.Load())/float64(seconds))
}

func placement(replay companion.Replay, raw *boards.Raw) {
	m := &companion.NameMatcher{}
	counts := map[string]int{}
	var unplaced []string
	for _, p := range replay.Picks {
		if _, how, ok := m.Match(raw, p); ok {
			counts[how]++
		} else {
			unplaced = append(unplaced, fmt.Sprintf("%s %s %s", p.Position, p.Name, p.Team))
		}
	}
	fmt.Printf("placement: %d picks, %d by exact name, %d by folded name, %d unplaced %v\n",
		len(replay.Picks), counts[companion.MatchExact], counts[companion.MatchNormalized], len(unplaced), unplaced)
}

func walk(ctx context.Context, replay companion.Replay, slot int, settings apitypes.LeagueSettings, board boards.Board) error {
	engine := advisor.Engine{Runs: sim.RoomOddsRuns, Workers: runtime.GOMAXPROCS(0)}
	var builds, cards []time.Duration
	for n := 0; n <= len(replay.Picks); n++ {
		began := time.Now()
		built, err := companion.Build(mock.Settings{League: settings, Pool: board.Pool()}, board.Raw, slot, replay.Picks[:n], &companion.NameMatcher{})
		if err != nil {
			return err
		}
		builds = append(builds, time.Since(began))
		if built.LostAt != nil {
			return fmt.Errorf("lost the draft at pick %d", *built.LostAt)
		}
		if !built.Draft.Waiting {
			continue
		}
		began = time.Now()
		if _, err := engine.Card(ctx, advisor.Request{State: built.Draft.State, TeamID: built.Draft.HumanTeamID, Board: board, Teams: settings.Teams, Seed: 1}); err != nil {
			return err
		}
		cards = append(cards, time.Since(began))
	}
	fmt.Printf("replay: %d rebuilds p50 %s p95 %s max %s; %d cards from the engine p50 %s p95 %s max %s\n",
		len(builds), pct(builds, 0.5), pct(builds, 0.95), pct(builds, 1), len(cards), pct(cards, 0.5), pct(cards, 0.95), pct(cards, 1))
	return nil
}

func pct(xs []time.Duration, q float64) time.Duration {
	s := append([]time.Duration(nil), xs...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	if len(s) == 0 {
		return 0
	}
	i := int(q*float64(len(s))+0.5) - 1
	return s[min(max(i, 0), len(s)-1)].Round(10 * time.Microsecond)
}
