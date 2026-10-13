package mock_test

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// benchSettings is a 12-team PPR standard room on the real 2026 board.
func benchSettings(b *testing.B) mock.Settings {
	b.Helper()
	raw, err := os.ReadFile("../../testdata/mocks/logs.json")
	if err != nil {
		b.Fatal(err)
	}
	var logs struct {
		Board []draft.PoolEntry `json:"board"`
	}
	if err := json.Unmarshal(raw, &logs); err != nil {
		b.Fatal(err)
	}
	slot, preset := 1, apitypes.ScoringPresetPpr
	return mock.Settings{
		League: apitypes.LeagueSettings{
			BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: apitypes.LineupStandard,
			Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
			Scoring: apitypes.Scoring{Preset: &preset}, Slot: &slot, Teams: 12,
		},
		Pool: logs.Board, StartedAt: "2026-08-15T18:00:00.000Z",
	}
}

// BenchmarkPickBatch is one solo pick in a 12-team room: the log replayed
// from the store's rows (what a stateless request does), the drafter's
// pick at 5.01, and every bot pick to 6.12 (slot one at the turn, 22 bot
// picks, the longest batch a 12-team snake has). Engine only; persistence
// is Lane 6's measure.
func BenchmarkPickBatch(b *testing.B) {
	s := benchSettings(b)
	const seed = 20261012
	d, err := mock.Run(s, seed, nil, mock.Options{AutopickThroughRound: 4})
	if err != nil {
		b.Fatal(err)
	}
	next, ok := draft.BestAvailableFor(d.State, d.HumanTeamID)
	if !ok {
		b.Fatal("no pick")
	}
	pick := mock.HumanPick{PlayerID: next.PlayerID}
	samples := make([]time.Duration, 0, b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		began := time.Now()
		state, err := draft.Replay(d.Config, d.Actions)
		if err != nil {
			b.Fatal(err)
		}
		held := d
		held.State = state
		if _, err := mock.Advance(s, seed, held, pick, mock.Options{}); err != nil {
			b.Fatal(err)
		}
		samples = append(samples, time.Since(began))
	}
	b.StopTimer()
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	b.ReportMetric(float64(samples[len(samples)/2].Microseconds()), "p50-us")
	b.ReportMetric(float64(samples[len(samples)*9/10].Microseconds()), "p90-us")
}

// BenchmarkHindsightFallback is the report's hindsight when no pick
// carries recorded odds: one 200-run room odds, seat model included, per
// drafter pick, for a finished 12-team mock (15 picks, 14 with a next
// turn). The report's own runs are set to one so this is the hindsight.
func BenchmarkHindsightFallback(b *testing.B) {
	s := benchSettings(b)
	const seed = 20261012
	d, err := mock.Run(s, seed, nil, mock.Options{AutopickThroughRound: 15})
	if err != nil {
		b.Fatal(err)
	}
	in := mock.ReportInput{
		Settings: s, Seed: seed, Draft: d, Runs: 1, Workers: 1,
		Odds: mock.SimOdds{Seed: seed, Runs: 200, Workers: runtime.GOMAXPROCS(0)},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := mock.BuildReport(context.Background(), in); err != nil {
			b.Fatal(err)
		}
	}
}
