package mock_test

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

type recorded struct {
	Board []draft.PoolEntry `json:"board"`
	Rooms []struct {
		Name       string            `json:"name"`
		Seed       uint32            `json:"seed"`
		Humans     []string          `json:"humans"`
		Config     draft.Config      `json:"config"`
		Actions    []json.RawMessage `json:"actions"`
		FinalState struct {
			Picks []draft.Pick `json:"picks"`
		} `json:"finalState"`
	} `json:"rooms"`
}

// settingsFor reads the league settings back off a recorded room's shape.
func settingsFor(t *testing.T, config draft.Config, teams int, slot int) apitypes.LeagueSettings {
	t.Helper()
	counts := map[draft.SlotType]int{}
	for _, row := range config.SlotConfig {
		counts[row.Slot] += row.Count
	}
	lineup := apitypes.LineupStandard
	switch {
	case counts[draft.SlotSuperflex] > 0:
		lineup = apitypes.LineupSuperflex
	case counts[draft.SlotFlex] == 2:
		lineup = apitypes.LineupTwoFlex
	}
	preset := apitypes.ScoringPresetPpr
	return apitypes.LeagueSettings{
		BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: lineup,
		Roster: apitypes.RosterCounts{
			Qb: counts[draft.SlotQB], Rb: counts[draft.SlotRB], Wr: counts[draft.SlotWR], Te: counts[draft.SlotTE],
			K: counts[draft.SlotK], Dst: counts[draft.SlotDEF], Bench: counts[draft.SlotBench],
		},
		Scoring: apitypes.Scoring{Preset: &preset}, Slot: &slot, Teams: teams,
	}
}

func poolFor(t *testing.T, board []draft.PoolEntry, start json.RawMessage) []draft.PoolEntry {
	t.Helper()
	var row struct {
		Gated []string `json:"excludedFromAutopick"`
	}
	if err := json.Unmarshal(start, &row); err != nil {
		t.Fatal(err)
	}
	gated := map[string]bool{}
	for _, id := range row.Gated {
		gated[id] = true
	}
	out := make([]draft.PoolEntry, len(board))
	for i, e := range board {
		out[i] = e
		out[i].ExcludedFromAutopick = gated[e.PlayerID]
	}
	return out
}

func sequence(picks []draft.Pick) string {
	parts := make([]string, len(picks))
	for i, p := range picks {
		parts[i] = fmt.Sprintf("%d:%s:%s", p.PickNumber, p.TeamID, p.PlayerID)
	}
	return strings.Join(parts, ",")
}

// TestRunReproducesTheRecordedRooms plays every one-human recorded room as
// a solo mock from its seed and the drafter's picks: every bot pick must
// land as the TypeScript room's did, with no delay and monotone stamps.
// Each room is also undone at every one of the drafter's picks, and the
// branch must be the recorded room up to that pick.
func TestRunReproducesTheRecordedRooms(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/mocks/logs.json")
	if err != nil {
		t.Fatal(err)
	}
	var logs recorded
	if err := json.Unmarshal(raw, &logs); err != nil {
		t.Fatal(err)
	}
	rooms, undos := 0, 0
	for _, room := range logs.Rooms {
		if len(room.Humans) != 1 {
			continue
		}
		var slot int
		if _, err := fmt.Sscanf(room.Humans[0], "seat%d", &slot); err != nil {
			t.Fatal(err)
		}
		teams := len(room.FinalState.Picks) / draft.TotalRosterSlots(room.Config.SlotConfig)
		settings := mock.Settings{League: settingsFor(t, room.Config, teams, slot), Pool: poolFor(t, logs.Board, room.Actions[0]), StartedAt: room.Config.KickoffAt}
		var picks []mock.HumanPick
		for _, p := range room.FinalState.Picks {
			if p.TeamID == room.Humans[0] {
				picks = append(picks, mock.HumanPick{PlayerID: p.PlayerID, At: p.Timestamp})
			}
		}
		d, err := mock.Run(settings, room.Seed, picks, mock.Options{})
		if err != nil {
			t.Fatalf("%s: %v", room.Name, err)
		}
		if got, want := sequence(d.State.Picks), sequence(room.FinalState.Picks); got != want {
			t.Fatalf("%s: the solo mock drafted differently\n go %.300s\n ts %.300s", room.Name, got, want)
		}
		checkMonotone(t, room.Name, d)
		stepped, err := mock.Run(settings, room.Seed, nil, mock.Options{})
		for i := 0; err == nil && i < len(picks); i++ {
			stepped, err = mock.Advance(settings, room.Seed, stepped, picks[i], mock.Options{})
		}
		if err != nil || sequence(stepped.State.Picks) != sequence(d.State.Picks) {
			t.Fatalf("%s: pick by pick the mock drafted differently: %v", room.Name, err)
		}
		for k := range picks {
			branch, err := mock.Undo(settings, room.Seed, picks, k, mock.Options{})
			if err != nil {
				t.Fatalf("%s undo %d: %v", room.Name, k, err)
			}
			if !branch.Waiting || !strings.HasPrefix(sequence(room.FinalState.Picks), sequence(branch.State.Picks)) {
				t.Fatalf("%s undo %d is not the room up to that pick", room.Name, k)
			}
			undos++
		}
		rooms++
	}
	t.Logf("solo mock: %d recorded rooms drafted pick for pick (whole and one batch at a time), %d undos branched at the drafter's pick", rooms, undos)
}

func checkMonotone(t *testing.T, name string, d mock.Draft) {
	t.Helper()
	last := int64(0)
	for i, a := range d.Actions {
		at, err := draft.ParseMillis(a.Timestamp)
		if err != nil || at < last {
			t.Fatalf("%s: action %d stamped %s goes backward", name, i+1, a.Timestamp)
		}
		last = at
	}
}
