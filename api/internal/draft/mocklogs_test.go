package draft_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// mockLogs is api/testdata/mocks/logs.json from scripts/export-mock-logs.ts.
type mockLogs struct {
	Board []draft.PoolEntry `json:"board"`
	Rooms []struct {
		Name       string            `json:"name"`
		Config     draft.Config      `json:"config"`
		Actions    []json.RawMessage `json:"actions"`
		FinalState json.RawMessage   `json:"finalState"`
	} `json:"rooms"`
}

// withoutNulls drops null members, so an absent optional field and an
// explicit null read the same on both sides.
func withoutNulls(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, x := range t {
			if x != nil {
				out[k] = withoutNulls(x)
			}
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = withoutNulls(x)
		}
		return out
	}
	return v
}

func canonical(t *testing.T, raw []byte, drop ...string) []byte {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	for _, k := range drop {
		delete(v, k)
	}
	out, err := json.Marshal(withoutNulls(v))
	if err != nil {
		t.Fatalf("encode state: %v", err)
	}
	return out
}

// startWithBoard puts the board back into a START_DRAFT row the export
// wrote as "$board" plus the ids it marked off the autopick.
func startWithBoard(t *testing.T, raw json.RawMessage, board []draft.PoolEntry) []byte {
	t.Helper()
	var row map[string]any
	if err := json.Unmarshal(raw, &row); err != nil {
		t.Fatal(err)
	}
	if row["type"] != string(draft.StartDraft) {
		return raw
	}
	gated := map[string]bool{}
	for _, id := range row["excludedFromAutopick"].([]any) {
		gated[id.(string)] = true
	}
	pool := make([]map[string]any, len(board))
	for i, e := range board {
		pool[i] = map[string]any{"playerId": e.PlayerID, "position": e.Position}
		if gated[e.PlayerID] {
			pool[i]["excludedFromAutopick"] = true
		}
	}
	row["pool"] = pool
	delete(row, "excludedFromAutopick")
	out, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// TestMockLogsReplayToTheSameFinalState replays every exported mock log
// through the Go reducer and compares the final state, field for field,
// with the state the TypeScript engine reached.
func TestMockLogsReplayToTheSameFinalState(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/mocks/logs.json")
	if err != nil {
		t.Fatalf("read logs: %v", err)
	}
	var logs mockLogs
	if err := json.Unmarshal(raw, &logs); err != nil {
		t.Fatalf("decode logs: %v", err)
	}
	total := 0
	for _, room := range logs.Rooms {
		actions := make([]draft.Action, len(room.Actions))
		for i, row := range room.Actions {
			a, err := draft.ParseAction(startWithBoard(t, row, logs.Board))
			if err != nil {
				t.Fatalf("%s action %d: %v", room.Name, i+1, err)
			}
			actions[i] = a
		}
		final, err := draft.Replay(room.Config, actions)
		if err != nil {
			t.Fatalf("%s: %v", room.Name, err)
		}
		got, err := json.Marshal(final)
		if err != nil {
			t.Fatal(err)
		}
		if g, w := canonical(t, got, "pool"), canonical(t, room.FinalState); !bytes.Equal(g, w) {
			t.Errorf("%s: final state differs\n go: %.400s\n ts: %.400s", room.Name, g, w)
		}
		total += len(actions)
	}
	t.Logf("mock logs: %d rooms, %d actions replayed to the TypeScript final state", len(logs.Rooms), total)
}
