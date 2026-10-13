package sim

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// RoomOddsRuns is the advisor's and the report's run count.
const RoomOddsRuns = 200

// DefaultChunkRuns is how many runs one worker plays before taking the next chunk.
const DefaultChunkRuns = 25

// RoomOddsInput is many seeded continuations of one room state.
type RoomOddsInput struct {
	State   draft.State
	Seed    uint32
	Runs    int
	Drivers Drivers
	// ExcludeFromOnClockSeat is the on-clock seat's own shortlist.
	ExcludeFromOnClockSeat map[string]bool
	Strategy               bots.Strategy
	Keepers                Keepers
	// ChunkRuns is the runs per chunk; Workers the chunks played at once.
	ChunkRuns int
	Workers   int
}

// RoomOddsTable is every pick every run made, the run's index its seed offset.
type RoomOddsTable struct {
	Runs        int            `json:"runs"`
	FromPick    int            `json:"fromPick"`
	ThroughPick int            `json:"throughPick"`
	Played      [][]PlayedPick `json:"played"`
	// Kept is every kept player: never read as still there, since he is
	// his seat's and no one else's.
	Kept map[string]bool `json:"-"`
}

// NextTurnFor is the seat's next pick after its current one, in snake order.
func NextTurnFor(s draft.State, teamID string) (int, bool) {
	start := s.PickNumber
	if team, ok := draft.TeamOnClock(s); ok && team == teamID {
		start = s.PickNumber + 1
	}
	last := draft.TotalPickCount(s)
	for pick := start; pick <= last; pick++ {
		if team, err := draft.SnakeTeamForPick(s.DraftOrder, pick); err == nil && team == teamID {
			return pick, true
		}
	}
	return 0, false
}

// FurthestNextTurn is how far one run plays to serve every seat.
func FurthestNextTurn(s draft.State) (int, bool) {
	furthest, found := 0, false
	for _, team := range s.DraftOrder {
		if turn, ok := NextTurnFor(s, team); ok && turn > furthest {
			furthest, found = turn, true
		}
	}
	return furthest, found
}

// SimulateRoomOdds plays Runs continuations (seeds Seed + run index)
// through the pick before the furthest next turn.
func SimulateRoomOdds(ctx context.Context, in RoomOddsInput) (RoomOddsTable, error) {
	runs := in.Runs
	if runs == 0 {
		runs = RoomOddsRuns
	}
	furthest, ok := FurthestNextTurn(in.State)
	through := in.State.PickNumber - 1
	if ok {
		through = furthest - 1
	}
	table := RoomOddsTable{Runs: runs, FromPick: in.State.PickNumber, ThroughPick: through, Played: make([][]PlayedPick, runs), Kept: in.Keepers.IDs()}
	if !ok {
		for i := range table.Played {
			table.Played[i] = []PlayedPick{}
		}
		return table, nil
	}
	results, err := RunMany(ctx, ManyInput{
		State: in.State, Seed: in.Seed, Runs: runs, ThroughPick: through, Drivers: in.Drivers,
		ExcludeFromOnClockSeat: in.ExcludeFromOnClockSeat, Strategy: in.Strategy, Keepers: in.Keepers,
		ChunkRuns: in.ChunkRuns, Workers: in.Workers,
	})
	if err != nil {
		return RoomOddsTable{}, err
	}
	for i, r := range results {
		table.Played[i] = r.Played
	}
	return table, nil
}

// ManyInput is RunMany's input: Continue's, Runs times.
type ManyInput struct {
	State                  draft.State
	Seed                   uint32
	Runs                   int
	ThroughPick            int
	Drivers                Drivers
	ExcludeFromOnClockSeat map[string]bool
	Strategy               bots.Strategy
	Keepers                Keepers
	ChunkRuns              int
	Workers                int
}

// RunMany plays Runs continuations in chunks across workers. Each run is
// seeded by its own index and shares nothing with its neighbours, so the
// split changes no run and no number; results are in run order.
func RunMany(ctx context.Context, in ManyInput) ([]ContinueResult, error) {
	chunk := max(1, in.ChunkRuns)
	if in.ChunkRuns == 0 {
		chunk = DefaultChunkRuns
	}
	workers := max(1, in.Workers)
	results := make([]ContinueResult, in.Runs)
	chunks := make(chan int)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for start := range chunks {
				for i := start; i < min(start+chunk, in.Runs); i++ {
					r, err := Continue(ContinueInput{
						State: in.State, Seed: in.Seed + uint32(i), ThroughPick: in.ThroughPick,
						ExcludeFromOnClockSeat: in.ExcludeFromOnClockSeat, Drivers: in.Drivers, Strategy: in.Strategy,
						Keepers: in.Keepers,
					})
					if err != nil {
						errs <- fmt.Errorf("sim: run %d: %w", i, err)
						return
					}
					results[i] = r
				}
			}
		}()
	}
	var sendErr error
send:
	for start := 0; start < in.Runs; start += chunk {
		select {
		case <-ctx.Done():
			sendErr = ctx.Err()
			break send
		case err := <-errs:
			sendErr = err
			break send
		case chunks <- start:
		}
	}
	close(chunks)
	wg.Wait()
	close(errs)
	if sendErr != nil {
		return nil, sendErr
	}
	if err := <-errs; err != nil {
		return nil, err
	}
	return results, nil
}

// reached is whether a run played every pick before pickNumber.
func reached(run []PlayedPick, fromPick, pickNumber int) bool {
	needed := pickNumber - fromPick
	return needed <= 0 || (len(run) >= needed && run[needed-1].PickNumber == pickNumber-1)
}

// SeatSurvival is, at a seat's next pick, how many runs reached it and in
// how many each undrafted player was still there.
type SeatSurvival struct {
	PickNumber  int            `json:"pickNumber"`
	RunsReached int            `json:"runsReached"`
	Survived    map[string]int `json:"survived"`
}

// SurvivalFor slices the table for one seat; the seat's own picks never
// count as gone.
func SurvivalFor(table RoomOddsTable, s draft.State, teamID string) (SeatSurvival, bool) {
	pickNumber, ok := NextTurnFor(s, teamID)
	if !ok {
		return SeatSurvival{}, false
	}
	taken := map[string]int{}
	runsReached := 0
	for _, run := range table.Played {
		if !reached(run, table.FromPick, pickNumber) {
			continue
		}
		runsReached++
		for _, p := range run {
			if p.PickNumber >= pickNumber {
				break
			}
			if p.TeamID != teamID {
				taken[p.PlayerID]++
			}
		}
	}
	survived := map[string]int{}
	for _, e := range draft.AvailablePool(s) {
		if !table.Kept[e.PlayerID] {
			survived[e.PlayerID] = runsReached - taken[e.PlayerID]
		}
	}
	return SeatSurvival{PickNumber: pickNumber, RunsReached: runsReached, Survived: survived}, true
}

// Share is a value and the fraction of runs it held.
type Share[T any] struct {
	Value T       `json:"value"`
	Share float64 `json:"share"`
}

// SeatTendency is what one pick ahead of the viewer landed on most.
type SeatTendency struct {
	TeamID      string                 `json:"teamId"`
	PickNumber  int                    `json:"pickNumber"`
	Runs        int                    `json:"runs"`
	TopPosition *Share[draft.Position] `json:"topPosition"`
	TopPlayer   *Share[string]         `json:"topPlayer"`
}

func topShare[T ~string](counts map[T]int, runs int) *Share[T] {
	if runs == 0 || len(counts) == 0 {
		return nil
	}
	keys := make([]T, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool {
		if counts[keys[i]] != counts[keys[j]] {
			return counts[keys[i]] > counts[keys[j]]
		}
		return jsmath.Collate(string(keys[i]), string(keys[j])) < 0
	})
	return &Share[T]{Value: keys[0], Share: float64(counts[keys[0]]) / float64(runs)}
}

// SeatsAheadFor is, for every pick between now and the viewer's next
// turn, the position and player that pick took most often.
func SeatsAheadFor(table RoomOddsTable, s draft.State, teamID string) []SeatTendency {
	next, ok := NextTurnFor(s, teamID)
	if !ok {
		return []SeatTendency{}
	}
	from := s.PickNumber
	if team, ok := draft.TeamOnClock(s); ok && team == teamID {
		from++
	}
	type tally struct {
		runs      int
		positions map[draft.Position]int
		players   map[string]int
	}
	tallies := map[int]*tally{}
	for pick := from; pick < next; pick++ {
		tallies[pick] = &tally{positions: map[draft.Position]int{}, players: map[string]int{}}
	}
	for _, run := range table.Played {
		for _, p := range run {
			t, ok := tallies[p.PickNumber]
			pos, known := s.Pool.PositionOf(p.PlayerID)
			if !ok || !known {
				continue
			}
			t.runs++
			t.positions[pos]++
			t.players[p.PlayerID]++
		}
	}
	out := make([]SeatTendency, 0, max(0, next-from))
	for pick := from; pick < next; pick++ {
		t := tallies[pick]
		team, _ := draft.SnakeTeamForPick(s.DraftOrder, pick)
		out = append(out, SeatTendency{
			TeamID: team, PickNumber: pick, Runs: t.runs,
			TopPosition: topShare(t.positions, t.runs), TopPlayer: topShare(t.players, t.runs),
		})
	}
	return out
}
