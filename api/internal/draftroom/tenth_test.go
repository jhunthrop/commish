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

// Each pick names his place on our board, the pool's order by points over
// replacement (Lane 66o), so the report's Picks later against our board is
// that place less the pick. A kicker or a defense has none.
func TestEachPickNamesItsPlaceOnOurBoard(t *testing.T) {
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
	out, err := Report(context.Background(), ReportInput{Settings: s, Seed: seed, Draft: d, Board: b, Runs: 4, Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	// Ahead of him: every player with more over replacement, and every one
	// with the same who comes first in the pool (ADP) order.
	place := map[string]int{}
	for i, p := range b.Raw.Players {
		place[p.ID] = i
	}
	above := func(id string) int {
		n := 0
		for other, v := range b.Values {
			if other != id && (v > b.Values[id] || v == b.Values[id] && place[other] < place[id]) {
				n++
			}
		}
		return n
	}
	for _, p := range out.Picks {
		_, valued := b.Values[p.PlayerId]
		switch {
		case !valued && p.BoardRank != nil:
			t.Fatalf("pick %d: %s has no value but place %d", p.Pick, p.PlayerId, *p.BoardRank)
		case valued && (p.BoardRank == nil || *p.BoardRank != above(p.PlayerId)+1):
			t.Fatalf("pick %d: %s place %v, want %d", p.Pick, p.PlayerId, p.BoardRank, above(p.PlayerId)+1)
		}
	}
}

// builtReport is a finished 15-round autopick draft on rawFor's board, and
// its report.
func builtReport(t *testing.T) (mock.Draft, boards.Board, apitypes.MockReport) {
	t.Helper()
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
	out, err := Report(context.Background(), ReportInput{Settings: s, Seed: seed, Draft: d, Board: b, Runs: 4, Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	return d, b, out
}

// Picks later against drafters is the pick less the ADP the column prints,
// rounded once and then subtracted (Lane 66o review M3), so every row adds
// up: rawFor's ADPs sit on x.45, where rounding the gap instead would split
// the column and the gap by a tenth.
func TestPicksLaterAddsUpWithTheADPColumn(t *testing.T) {
	_, _, out := builtReport(t)
	adp := map[string]*float64{}
	for _, p := range out.Board.Players {
		adp[p.Id] = p.Adp
	}
	checked := 0
	for _, p := range out.Picks {
		shown := adp[p.PlayerId]
		if shown == nil {
			if p.AdpGap != nil {
				t.Fatalf("pick %d: a gap %v with no ADP", p.Pick, *p.AdpGap)
			}
			continue
		}
		want := tenth.Round(float64(p.Pick) - *shown)
		if p.AdpGap == nil || *p.AdpGap != want {
			t.Fatalf("pick %d: ADP %v prints a gap %v, want %v", p.Pick, *shown, p.AdpGap, want)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no pick carries an ADP")
	}
}

// Picks later against our board (board_gap) is the pick's place among the
// draft's picks of players our board ranks, less his place on the board:
// kickers and defenses are counted on neither side, since our board ranks
// them by no points. A kicker or defense has none.
func TestTheBoardGapCountsNeitherKickersNorDefenses(t *testing.T) {
	d, b, out := builtReport(t)
	valuedPick := map[int]int{}
	n, marketBefore := 0, false
	for _, p := range d.State.Picks {
		if _, ok := b.Values[p.PlayerID]; ok {
			n++
			valuedPick[p.PickNumber] = n
		}
	}
	for _, p := range out.Picks {
		if _, ok := valuedPick[p.Pick]; !ok {
			if p.BoardGap != nil {
				t.Fatalf("pick %d: %s has no place on our board but a gap %d", p.Pick, p.PlayerId, *p.BoardGap)
			}
			continue
		}
		if valuedPick[p.Pick] < p.Pick {
			marketBefore = true
		}
		want := valuedPick[p.Pick] - *p.BoardRank
		if p.BoardGap == nil || *p.BoardGap != want {
			t.Fatalf("pick %d: board gap %v, want %d", p.Pick, p.BoardGap, want)
		}
	}
	if !marketBefore {
		t.Fatal("no valued pick came after a kicker or defense: the test does not see the basis")
	}
}
