package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// waiverLine is a free agent or a roster player whose game is in the state
// given.
func waiverLine(name string, state apitypes.GameState) apitypes.PlayerLine {
	kickoff := time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	s := state
	return apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: name, Name: name},
		Facts: apitypes.WeekFacts{Week: 6, Kickoff: &kickoff, GameState: &s}}
}

func waiverRowOf(add string, state apitypes.GameState, gain, weekGain float64) apitypes.WaiverRow {
	drop := waiverLine("drop-"+add, apitypes.GameStateUpcoming)
	beatsGain := weekGain
	return apitypes.WaiverRow{Add: waiverLine(add, state), Drop: &drop, Gain: gain, WeekGain: fp(weekGain),
		Pickup: weekGain > 0, Beats: &apitypes.WaiverBeats{HostId: "b", Name: "B", Starter: true, Gain: &beatsGain},
		Drops: []apitypes.WaiverDrop{{HostId: "drop-" + add, Gain: gain, WeekGain: fp(weekGain)}}}
}

// A pickup whose game has kicked off flips the page to the one season
// rule (Lane 85 fix round 3, M-E): the rows go by the season Gain, the strip
// names the first of them with its drop, and no week figure is left.
func TestALockedPickupOrdersThePageBySeasonGain(t *testing.T) {
	taylor := waiverRowOf("taylor", apitypes.GameStateFinal, 0.0, 4.8)
	hutchinson := waiverRowOf("hutchinson", apitypes.GameStateFinal, 1.8, 0.2)
	tremble := waiverRowOf("tremble", apitypes.GameStateFinal, 0.9, 1.1)
	proj := 80.0
	out := apitypes.WaiverAdvice{Week: 6, Basis: WaiversBasis, Rows: []apitypes.WaiverRow{taylor, tremble, hutchinson},
		Pickups: []apitypes.WaiverRow{taylor}, LineupProj: &proj, PickupsProj: &proj}
	inSeasonOrder(&out)
	var names []string
	for _, r := range out.Rows {
		names = append(names, r.Add.Player.Name)
		if r.WeekGain != nil || r.Drops[0].WeekGain != nil || r.Beats.Gain != nil {
			t.Fatalf("%s keeps a week figure: %+v", r.Add.Player.Name, r)
		}
	}
	if len(names) != 3 || names[0] != "hutchinson" || names[1] != "tremble" || names[2] != "taylor" {
		t.Fatalf("rows %v, want by season Gain", names)
	}
	if len(out.Pickups) != 1 || out.Pickups[0].Add.Player.Name != out.Rows[0].Add.Player.Name ||
		out.Pickups[0].Drop == nil || out.Pickups[0].Drop.Player.Name != "drop-hutchinson" {
		t.Fatalf("the strip %+v, want the first row with its drop", out.Pickups)
	}
	if !out.Rows[0].Pickup || out.Rows[2].Pickup {
		t.Errorf("pickup marks %v %v", out.Rows[0].Pickup, out.Rows[2].Pickup)
	}
	if out.LineupProj != nil || out.PickupsProj != nil {
		t.Errorf("the week's Proj sums are held")
	}
	if out.Basis != "Pickups go in Gain order once their week 6 games kick off." {
		t.Errorf("basis %q", out.Basis)
	}
}

// Before any pickup's game kicks off the API's week order stands.
func TestTheWeekOrderStandsBeforeKickoff(t *testing.T) {
	taylor := waiverRowOf("taylor", apitypes.GameStateUpcoming, 0.0, 4.8)
	hutchinson := waiverRowOf("hutchinson", apitypes.GameStateUpcoming, 1.8, 0.2)
	out := apitypes.WaiverAdvice{Week: 6, Basis: WaiversBasis, Rows: []apitypes.WaiverRow{taylor, hutchinson},
		Pickups: []apitypes.WaiverRow{taylor}}
	inSeasonOrder(&out)
	if out.Rows[0].Add.Player.Name != "taylor" || out.Pickups[0].Add.Player.Name != "taylor" || out.Rows[0].WeekGain == nil ||
		out.Basis != WaiversBasis {
		t.Fatalf("the week order changed before kickoff: %+v", out)
	}
}
