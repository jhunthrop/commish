package draftroom

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// reportSettings is a 12-team PPR standard room on the recorded 2026 pool.
func reportSettings(t *testing.T) mock.Settings {
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

// rawFor is a board over the pool whose ADP and points carry hundredths
// on the halfway mark (x.x5), so a figure the wire sends unrounded, or
// rounded to two decimals, is caught.
func rawFor(pool []draft.PoolEntry) *boards.Raw {
	raw := &boards.Raw{Format: boards.PPR, Season: 2026}
	for i, e := range pool {
		adp := float64(i+1) + 0.45
		p := boards.Player{ID: e.PlayerID, Name: e.PlayerID, Position: e.Position, Team: "DAL", ADP: &adp}
		if e.Position != draft.K && e.Position != draft.DEF {
			points := 300 - float64(i)*0.73 + 0.05
			p.Points = &points
		}
		raw.Players = append(raw.Players, p)
	}
	return raw
}

func isTenth(v float64) bool { return v == tenth.Round(v) }

func isTenthp(v *float64) bool { return v == nil || isTenth(*v) }

// Every figure the room's board sends leaves as the tenth the screen
// prints (Lane 66k H1): ADP, points and over replacement.
func TestTheRoomsBoardIsInTenths(t *testing.T) {
	s := reportSettings(t)
	slots, err := mock.SlotConfig(s.League)
	if err != nil {
		t.Fatal(err)
	}
	b, err := boards.For(rawFor(s.Pool), 12, slots)
	if err != nil {
		t.Fatal(err)
	}
	view := BoardView(b, nil)
	if len(view.Players) == 0 {
		t.Fatal("an empty board")
	}
	for _, p := range view.Players {
		if !isTenthp(p.Adp) || !isTenthp(p.Points) || !isTenthp(p.Vor) {
			t.Fatalf("%s: adp %v points %v vor %v are not tenths", p.Id, p.Adp, p.Points, p.Vor)
		}
	}
	if first := view.Players[0]; first.Adp == nil || *first.Adp != 1.5 {
		t.Fatalf("the first ADP %v, want 1.45 sent as 1.5", first.Adp)
	}
}

// Every figure the report sends leaves as a tenth: each team's points and
// value captured, each pick's ADP gap and over replacement, the runs'
// median, middle range and points. Chances keep their two decimals.
func TestTheReportIsInTenths(t *testing.T) {
	s := reportSettings(t)
	const seed = 20261017
	d, err := mock.Run(s, seed, nil, mock.Options{AutopickThroughRound: 15})
	if err != nil {
		t.Fatal(err)
	}
	slots, err := mock.SlotConfig(s.League)
	if err != nil {
		t.Fatal(err)
	}
	b, err := boards.For(rawFor(s.Pool), 12, slots)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Report(context.Background(), ReportInput{Settings: s, Seed: seed, Draft: d, Board: b, Runs: 20, Workers: 2})
	if err != nil {
		t.Fatal(err)
	}
	for _, team := range out.Standings {
		if !isTenth(team.Points) || !isTenth(team.ValueCaptured) {
			t.Fatalf("seat %d: points %v value captured %v are not tenths", team.Seat, team.Points, team.ValueCaptured)
		}
	}
	gaps := 0
	for _, p := range out.Picks {
		if !isTenthp(p.AdpGap) || !isTenthp(p.OverReplacement) {
			t.Fatalf("pick %d: ADP gap %v over replacement %v are not tenths", p.Pick, p.AdpGap, p.OverReplacement)
		}
		if p.AdpGap != nil {
			gaps++
		}
	}
	if gaps == 0 {
		t.Fatal("no pick carries an ADP gap")
	}
	r := out.Runs
	if !isTenth(r.Median) || !isTenth(r.MiddleLow) || !isTenth(r.MiddleHigh) {
		t.Fatalf("runs median %v middle %v to %v are not tenths", r.Median, r.MiddleLow, r.MiddleHigh)
	}
	for _, p := range r.Points {
		if !isTenth(p) {
			t.Fatalf("a run's points %v are not a tenth", p)
		}
	}
	for _, p := range out.Board.Players {
		if !isTenthp(p.Adp) || !isTenthp(p.Points) || !isTenthp(p.Vor) {
			t.Fatalf("report board %s: adp %v points %v vor %v are not tenths", p.Id, p.Adp, p.Points, p.Vor)
		}
	}
}
