package mock_test

import (
	"context"
	"testing"

	"github.com/jhunthrop/commish/api/internal/mock"
)

// A pick from deeper than the card the room recorded has no chance in it, so his hindsight is
// computed instead of left blank as if it were the last pick.
func TestReportComputesHindsightPastTheRecordedDepth(t *testing.T) {
	s := testSettings(t)
	const seed = 20261014
	whole, err := mock.Run(s, seed, nil, mock.Options{AutopickThroughRound: 1})
	if err != nil {
		t.Fatal(err)
	}
	var first string
	for _, p := range whole.State.Picks {
		if p.TeamID == whole.HumanTeamID {
			first = p.PlayerID
		}
	}
	recorded := &mock.PickOdds{Source: "advisor", StillThere: map[string]float64{"someone-else": 0.4}}
	picks := []mock.HumanPick{{PlayerID: first, Odds: recorded}}
	d, err := mock.Run(s, seed, picks, mock.Options{AutopickThroughRound: 15})
	if err != nil {
		t.Fatal(err)
	}
	asked := 0
	r, err := mock.BuildReport(context.Background(), mock.ReportInput{
		Settings: s, Seed: seed, Draft: d, Runs: 1, Workers: 1, Odds: fixedOdds{asked: &asked},
	})
	if err != nil {
		t.Fatal(err)
	}
	if asked != 1 || r.Picks[0].StillThere == nil || r.Picks[0].OddsSource != "fallback_sim" {
		t.Fatalf("asked %d, first pick %+v", asked, r.Picks[0])
	}
}
