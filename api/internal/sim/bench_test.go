package sim_test

import (
	"context"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

func benchRoomOdds(b *testing.B, workers int) {
	f, actions := load(b)
	state, err := draft.Replay(f.Room.Config, actions)
	if err != nil {
		b.Fatal(err)
	}
	samples := make([]time.Duration, 0, b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		began := time.Now()
		drivers := sim.InferSeatDrivers(state, bots.DefaultStrategy(), sim.DefaultSeatModel())
		if _, err := sim.SimulateRoomOdds(context.Background(), sim.RoomOddsInput{
			State: state, Seed: f.Seed, Runs: sim.RoomOddsRuns, Drivers: drivers,
			ExcludeFromOnClockSeat: set(f.Exclude), Strategy: bots.DefaultStrategy(), Workers: workers,
		}); err != nil {
			b.Fatal(err)
		}
		samples = append(samples, time.Since(began))
	}
	b.StopTimer()
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	b.ReportMetric(float64(samples[len(samples)/2].Microseconds())/1000, "p50-ms")
	b.ReportMetric(float64(samples[len(samples)*9/10].Microseconds())/1000, "p90-ms")
}

// BenchmarkRoomOdds200 is the advisor's table for the recorded 12-team
// room at pick 58: the seat model's read of every seat, then 200 runs.
func BenchmarkRoomOdds200(b *testing.B) { benchRoomOdds(b, runtime.GOMAXPROCS(0)) }

// BenchmarkRoomOdds200OneCore is the same on one worker: what a Cloud Run
// instance with one vCPU pays.
func BenchmarkRoomOdds200OneCore(b *testing.B) { benchRoomOdds(b, 1) }

// BenchmarkReportRuns200 is the report's 200 runs: the room from pick one
// to the end, the drafter on autopick, every run graded.
func BenchmarkReportRuns200(b *testing.B) {
	f, actions := load(b)
	started, err := draft.Replay(f.Room.Config, actions[:1])
	if err != nil {
		b.Fatal(err)
	}
	drivers := sim.Drivers{f.Report.Humans[0]: {Kind: sim.DriveAutopick}, f.Report.Humans[1]: {Kind: sim.DriveAutopick}}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		results, err := sim.RunMany(context.Background(), sim.ManyInput{
			State: started, Seed: f.Report.Seed, Runs: sim.RoomOddsRuns, ThroughPick: draft.TotalPickCount(started),
			Drivers: drivers, Strategy: bots.DefaultStrategy(), Workers: runtime.GOMAXPROCS(0),
		})
		if err != nil {
			b.Fatal(err)
		}
		for _, r := range results {
			sim.Grade(sim.GradeInputFor(r.Final, f.Report.Points, f.Report.Values, f.Report.Byes, f.Report.NFLTeams))
		}
	}
}
