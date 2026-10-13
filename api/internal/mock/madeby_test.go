package mock_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// testSettings is a 12-team PPR standard room on the real 2026 board.
func testSettings(t *testing.T) mock.Settings {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/mocks/logs.json")
	if err != nil {
		t.Fatal(err)
	}
	var logs struct {
		Board []draft.PoolEntry `json:"board"`
	}
	if err := json.Unmarshal(raw, &logs); err != nil {
		t.Fatal(err)
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

// fixedOdds answers every fallback with the same chance, so a test sees
// which picks asked for hindsight.
type fixedOdds struct{ asked *int }

func (o fixedOdds) Survival(_ context.Context, req mock.OddsRequest) (mock.PickOdds, error) {
	*o.asked++
	return mock.PickOdds{Source: "sim", StillThere: map[string]float64{req.PassedOn: 0.7}}, nil
}

// A finished mock whose first three picks were the drafter's and the rest
// "Pick for me": the report marks the stand-in's picks and gives them no
// hindsight, and the marks survive the log's round trip.
func TestReportMarksPicksMadeForYou(t *testing.T) {
	s := testSettings(t)
	const seed = 20261013
	whole, err := mock.Run(s, seed, nil, mock.Options{AutopickThroughRound: 15})
	if err != nil {
		t.Fatal(err)
	}
	var mine []string
	for _, p := range whole.State.Picks {
		if p.TeamID == whole.HumanTeamID {
			mine = append(mine, p.PlayerID)
		}
	}
	const chosen = 3
	picks := make([]mock.HumanPick, len(mine))
	for i, id := range mine {
		picks[i] = mock.HumanPick{PlayerID: id}
		if i >= chosen {
			picks[i].By = mock.MadeForYou
		}
	}
	d, err := mock.Run(s, seed, picks, mock.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.By) != len(mine)-chosen {
		t.Fatalf("the draft marks %d picks, want %d", len(d.By), len(mine)-chosen)
	}

	entries, err := mock.LogEntries(d, 1)
	if err != nil {
		t.Fatal(err)
	}
	payloads := make([]json.RawMessage, len(entries))
	for i, e := range entries {
		if payloads[i], err = json.Marshal(e.Payload); err != nil {
			t.Fatal(err)
		}
	}
	replayed, err := mock.FromLog(s, seed, payloads)
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed.By) != len(d.By) {
		t.Fatalf("the log keeps %d marks, want %d", len(replayed.By), len(d.By))
	}

	asked := 0
	r, err := mock.BuildReport(context.Background(), mock.ReportInput{
		Settings: s, Seed: seed, Draft: replayed, Runs: 1, Workers: 1, Odds: fixedOdds{asked: &asked},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Picks) != len(mine) {
		t.Fatalf("the report reviews %d picks, want %d", len(r.Picks), len(mine))
	}
	for i, p := range r.Picks {
		want := mock.MadeByYou
		if i >= chosen {
			want = mock.MadeForYou
		}
		if p.MadeBy != want {
			t.Errorf("pick %d made by %q, want %q", p.PickNumber, p.MadeBy, want)
		}
		if p.MadeBy != mock.MadeByYou && p.StillThere != nil {
			t.Errorf("pick %d was made for you and still carries hindsight", p.PickNumber)
		}
	}
	if asked != chosen {
		t.Fatalf("hindsight was computed for %d picks, want only your %d", asked, chosen)
	}
}

// "Pick for me" inside Run marks its picks too.
func TestRunAutopickMarksItsPicks(t *testing.T) {
	s := testSettings(t)
	d, err := mock.Run(s, 7, nil, mock.Options{AutopickThroughRound: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.By) != 2 {
		t.Fatalf("two rounds of Pick for me marked %d picks", len(d.By))
	}
	for seq, by := range d.By {
		if by != mock.MadeForYou || d.Actions[seq-1].TeamID != d.HumanTeamID {
			t.Fatalf("action %d marked %q for %s", seq, by, d.Actions[seq-1].TeamID)
		}
	}
}
