package companion

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sim"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

func (s *Service) report(w http.ResponseWriter, r *http.Request) {
	row, ok := s.load(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if raw, ok, err := s.Store.Report(ctx, row.ID); err != nil || ok {
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "companion: report", err)
			return
		}
		httpx.WriteOK(w, r, http.StatusOK, json.RawMessage(raw))
		return
	}
	f, err := s.follow(ctx, row)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	if f.read.Draft.Status != sleeper.StatusComplete || f.built.LostAt != nil {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "The report comes when the draft is over", nil)
		return
	}
	out, err := s.buildReport(ctx, f)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: report", err)
		return
	}
	if err := s.Store.PutReport(ctx, row.ID, out); err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: report", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// buildReport is the mock report's builder on the host draft's final
// state: the standings, the drafter's picks with the odds the companion
// showed at each (the engine's hindsight where it showed none), and 200
// more runs of the draft from pick one.
func (s *Service) buildReport(ctx context.Context, f followed) (any, error) {
	d := f.built.Draft
	cards, err := s.Store.Cards(ctx, f.row.ID)
	if err != nil {
		return nil, err
	}
	d.Odds = map[int]mock.PickOdds{}
	// The companion's log is START_DRAFT then one MAKE_PICK per pick, so
	// the action at index i made pick i, and its 1-based seq is i+1.
	for i, a := range d.Actions {
		if a.TeamID != d.HumanTeamID {
			continue
		}
		raw, ok := cards[i]
		if !ok {
			continue
		}
		var c advisor.Card
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, fmt.Errorf("companion: decode card: %w", err)
		}
		if odds := draftroom.PickOdds(c); odds != nil {
			d.Odds[i+1] = *odds
		}
	}
	// The host's keepers are the league's: the report passes over them as
	// choices, and its 200 runs keep each at his seat and round.
	league := f.row.Settings
	league.Keepers = []apitypes.Keeper{}
	for _, p := range f.built.Placed {
		if p.Pick.Keeper {
			id := p.PlayerID
			if id == "" {
				id = unplacedPrefix + p.Pick.PlayerID
			}
			league.Keepers = append(league.Keepers, apitypes.Keeper{Slot: p.Pick.Slot, PlayerId: id, Round: p.Pick.Round})
		}
	}
	seed := seedOf(f.row.HostDraftID)
	return draftroom.Report(ctx, draftroom.ReportInput{
		Settings: mock.Settings{League: league, Pool: d.State.Pool.Entries()}, Seed: seed, Draft: d, Board: f.board,
		Odds: mock.SimOdds{Runs: sim.RoomOddsRuns, Workers: s.ReportWorkers}, Runs: sim.RoomOddsRuns, Workers: s.ReportWorkers,
	})
}
