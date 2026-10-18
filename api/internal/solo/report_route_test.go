package solo

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// reportRouteBoard is a board over the recorded 2026 pool whose ADPs sit on
// x.45, where a gap rounded after subtracting splits from the ADP column.
func reportRouteBoard(t *testing.T) *boards.Raw {
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
	out := &boards.Raw{Format: boards.PPR, Season: 2026}
	for i, e := range logs.Board {
		adp := float64(i+1) + 0.45
		p := boards.Player{ID: e.PlayerID, Name: e.PlayerID, Position: e.Position, Team: "DAL", ADP: &adp}
		if e.Position != draft.K && e.Position != draft.DEF {
			points := 300 - float64(i)*0.73 + 0.05
			p.Points = &points
		}
		out.Players = append(out.Players, p)
	}
	return out
}

// The shared report route sends both Picks later figures from the API
// (Lane 66o review H1, M3): against drafters, the pick less the ADP the
// report's board prints; against our board, the pick's place among picks of
// players our board ranks less his place on it, kickers and defenses on
// neither side and with no gap of their own.
func TestTheReportRouteSendsBothPicksLater(t *testing.T) {
	slot, preset := 1, apitypes.ScoringPresetPpr
	league := apitypes.LeagueSettings{
		BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: apitypes.LineupStandard,
		Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
		Scoring: apitypes.Scoring{Preset: &preset}, Slot: &slot, Teams: 12,
	}
	raw := reportRouteBoard(t)
	src := fixedBoards{raw}
	b, err := src.For(t.Context(), league)
	if err != nil {
		t.Fatal(err)
	}
	const seed = 20261017
	settings := mock.Settings{League: league, Pool: b.Pool(), StartedAt: sharedEpoch}
	whole, err := mock.Run(settings, seed, nil, mock.Options{AutopickThroughRound: 15})
	if err != nil {
		t.Fatal(err)
	}
	sh := share{V: shareVersion, Settings: league, Seed: seed}
	for _, p := range whole.State.Picks {
		if p.TeamID == whole.HumanTeamID {
			sh.ForYou = append(sh.ForYou, len(sh.Picks))
			sh.Picks = append(sh.Picks, p.PlayerID)
		}
	}
	keys := signer(t, testSecret)
	code, err := encodeShare(sh, keys)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{Boards: src, Shares: keys, ReportWorkers: 2, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	r := httptest.NewRequest(http.MethodGet, "/shared/mocks/"+code+"/report", nil)
	r.SetPathValue("code", code)
	w := httptest.NewRecorder()
	s.handleSharedReport(w, r)
	var env struct {
		Data apitypes.MockReport `json:"data"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &env) != nil {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	report := env.Data

	printed := map[string]float64{}
	for _, p := range report.Board.Players {
		if p.Adp != nil {
			printed[p.Id] = *p.Adp
		}
	}
	valuedPick := map[int]int{}
	n := 0
	for _, p := range whole.State.Picks {
		if _, ok := b.Values[p.PlayerID]; ok {
			n++
			valuedPick[p.PickNumber] = n
		}
	}
	market := 0
	for _, p := range report.Picks {
		adp, priced := printed[p.PlayerId]
		if want := tenth.Round(float64(p.Pick) - adp); priced && (p.AdpGap == nil || *p.AdpGap != want) {
			t.Fatalf("pick %d: ADP %v, gap %v, want %v", p.Pick, adp, p.AdpGap, want)
		}
		// The chip reads the printed gap: within 3 at ADP, plus a steal,
		// minus a reach (Lane 66o re-review N6).
		if priced {
			gap := *p.AdpGap
			want := apitypes.ReportPickChip("at_adp")
			if gap <= -mock.AtADPWithin {
				want = "reach"
			} else if gap >= mock.AtADPWithin {
				want = "steal"
			}
			if p.Chip != want {
				t.Fatalf("pick %d: printed gap %v but chip %q, want %q", p.Pick, gap, p.Chip, want)
			}
		}
		at, valued := valuedPick[p.Pick]
		if !valued {
			market++
			if p.BoardGap != nil || p.BoardRank != nil {
				t.Fatalf("pick %d: a kicker or defense with a place %v and gap %v", p.Pick, p.BoardRank, p.BoardGap)
			}
			continue
		}
		if p.BoardRank == nil || p.BoardGap == nil || *p.BoardGap != at-*p.BoardRank {
			t.Fatalf("pick %d: place %v gap %v, want %d less the place", p.Pick, p.BoardRank, p.BoardGap, at)
		}
	}
	if market == 0 {
		t.Fatal("the drafter took no kicker or defense: the test does not see them")
	}
}
