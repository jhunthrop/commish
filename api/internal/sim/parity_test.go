package sim_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// fixture is api/testdata/sim/continue-1000.json, recorded through the
// TypeScript sim by scripts/export-continue-fixture.ts.
type fixture struct {
	Room struct {
		Config  draft.Config      `json:"config"`
		Actions []json.RawMessage `json:"actions"`
	} `json:"room"`
	Board   []draft.PoolEntry `json:"board"`
	Seed    uint32            `json:"seed"`
	OnClock string            `json:"onClock"`
	Exclude []string          `json:"exclude"`
	Drivers sim.Drivers       `json:"drivers"`
	Table   struct {
		Runs        int      `json:"runs"`
		FromPick    int      `json:"fromPick"`
		ThroughPick int      `json:"throughPick"`
		Played      []string `json:"played"`
	} `json:"table"`
	Seats []struct {
		TeamID     string             `json:"teamId"`
		Survival   *sim.SeatSurvival  `json:"survival"`
		SeatsAhead []sim.SeatTendency `json:"seatsAhead"`
	} `json:"seats"`
	Report struct {
		Seed     uint32             `json:"seed"`
		Runs     int                `json:"runs"`
		Humans   []string           `json:"humans"`
		Points   map[string]float64 `json:"points"`
		Values   map[string]float64 `json:"values"`
		Byes     map[string]int     `json:"byes"`
		NFLTeams map[string]string  `json:"nflTeams"`
		Results  []struct {
			Played string          `json:"played"`
			Grades []sim.TeamGrade `json:"grades"`
		} `json:"results"`
	} `json:"report"`
}

func load(t testing.TB) (fixture, []draft.Action) {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/sim/continue-1000.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	actions := make([]draft.Action, len(f.Room.Actions))
	for i, row := range f.Room.Actions {
		var probe map[string]any
		if err := json.Unmarshal(row, &probe); err != nil {
			t.Fatal(err)
		}
		if probe["pool"] == "$board" {
			probe["pool"] = f.Board
			if row, err = json.Marshal(probe); err != nil {
				t.Fatal(err)
			}
		}
		a, err := draft.ParseAction(row)
		if err != nil {
			t.Fatalf("action %d: %v", i+1, err)
		}
		actions[i] = a
	}
	return f, actions
}

func ids(run []sim.PlayedPick) string {
	out := make([]string, len(run))
	for i, p := range run {
		out[i] = p.PlayerID
	}
	return strings.Join(out, ",")
}

func set(list []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range list {
		out[id] = true
	}
	return out
}

// TestContinueFixture is the 1,000-run oracle: the seat model's read of
// every seat, every run's every pick, and every seat's survival and
// seats-ahead table.
func TestContinueFixture(t *testing.T) {
	f, actions := load(t)
	state, err := draft.Replay(f.Room.Config, actions)
	if err != nil {
		t.Fatal(err)
	}
	drivers := sim.InferSeatDrivers(state, bots.DefaultStrategy(), sim.DefaultSeatModel())
	for team, want := range f.Drivers {
		got := drivers[team]
		if got.Kind != want.Kind || got.Archetype.Name != want.Archetype.Name || got.Basis != want.Basis || got.PicksObserved != want.PicksObserved {
			t.Errorf("seat %s read as %+v, TypeScript %+v", team, got, want)
		}
	}
	table, err := sim.SimulateRoomOdds(context.Background(), sim.RoomOddsInput{
		State: state, Seed: f.Seed, Runs: f.Table.Runs, Drivers: f.Drivers,
		ExcludeFromOnClockSeat: set(f.Exclude), Strategy: bots.DefaultStrategy(), Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	if table.FromPick != f.Table.FromPick || table.ThroughPick != f.Table.ThroughPick {
		t.Fatalf("table spans %d..%d, TypeScript %d..%d", table.FromPick, table.ThroughPick, f.Table.FromPick, f.Table.ThroughPick)
	}
	picks := 0
	for i, want := range f.Table.Played {
		if got := ids(table.Played[i]); got != want {
			t.Fatalf("run %d differs\n go %s\n ts %s", i, got, want)
		}
		picks += len(table.Played[i])
	}
	for _, seat := range f.Seats {
		checkSeat(t, table, state, seat.TeamID, seat.Survival, seat.SeatsAhead)
	}
	t.Logf("continue: %d runs, %d picks, %d seats' survival and seats ahead match", len(f.Table.Played), picks, len(f.Seats))
}

func checkSeat(t *testing.T, table sim.RoomOddsTable, state draft.State, team string, wantSurvival *sim.SeatSurvival, wantAhead []sim.SeatTendency) {
	t.Helper()
	got, ok := sim.SurvivalFor(table, state, team)
	switch {
	case !ok && wantSurvival != nil, ok && wantSurvival == nil:
		t.Errorf("%s survival presence differs", team)
	case ok && (got.PickNumber != wantSurvival.PickNumber || got.RunsReached != wantSurvival.RunsReached || fmt.Sprint(got.Survived) != fmt.Sprint(wantSurvival.Survived)):
		t.Errorf("%s survival differs", team)
	}
	gotJSON, _ := json.Marshal(sim.SeatsAheadFor(table, state, team))
	wantJSON, _ := json.Marshal(wantAhead)
	if string(gotJSON) != string(wantJSON) {
		t.Errorf("%s seats ahead differ\n go %s\n ts %s", team, gotJSON, wantJSON)
	}
}

// TestReportRunsFixture is the report's runs: the room from pick one with
// the humans on autopick, played to the end and graded, every number.
func TestReportRunsFixture(t *testing.T) {
	f, actions := load(t)
	started, err := draft.Replay(f.Room.Config, actions[:1])
	if err != nil {
		t.Fatal(err)
	}
	drivers := sim.Drivers{}
	for _, h := range f.Report.Humans {
		drivers[h] = sim.Driver{Kind: sim.DriveAutopick}
	}
	results, err := sim.RunMany(context.Background(), sim.ManyInput{
		State: started, Seed: f.Report.Seed, Runs: f.Report.Runs, ThroughPick: draft.TotalPickCount(started),
		Drivers: drivers, Strategy: bots.DefaultStrategy(), Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range f.Report.Results {
		if got := ids(results[i].Played); got != want.Played {
			t.Fatalf("report run %d picks differ", i)
		}
		grades := sim.Grade(sim.GradeInputFor(results[i].Final, f.Report.Points, f.Report.Values, f.Report.Byes, f.Report.NFLTeams))
		gotJSON, _ := json.Marshal(grades)
		wantJSON, _ := json.Marshal(want.Grades)
		if string(gotJSON) != string(wantJSON) {
			t.Fatalf("report run %d grades differ\n go %s\n ts %s", i, gotJSON, wantJSON)
		}
	}
	t.Logf("report: %d full runs, every pick and every team's grade match", len(f.Report.Results))
}
