package draftroom

import (
	"context"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sim"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// exposureRows is how many players "who you end up with" lists.
const exposureRows = 12

// ReportInput is a finished draft and what its report reads.
type ReportInput struct {
	Settings mock.Settings
	Seed     uint32
	Draft    mock.Draft
	Board    boards.Board
	// Odds is the hindsight fallback for a pick that recorded none.
	Odds    mock.Odds
	Runs    int
	Workers int
}

// Report is the report on the wire: the standings, the drafter's picks
// with hindsight, the lineup, the 200 runs from pick one, and the board
// rows for every player it names.
func Report(ctx context.Context, in ReportInput) (apitypes.MockReport, error) {
	began := time.Now()
	b := in.Board
	odds := in.Odds
	// The engine's hindsight runs from the draft's own seed, so a
	// report reads the same twice.
	if engine, ok := odds.(mock.SimOdds); ok {
		engine.Seed = in.Seed
		odds = engine
	}
	r, err := mock.BuildReport(ctx, mock.ReportInput{
		Settings: in.Settings, Seed: in.Seed, Draft: in.Draft, Odds: odds, Runs: in.Runs, Workers: in.Workers,
		Board: mock.Board{Points: b.Points(), Values: b.Values, ADP: b.ADPs(), NFLTeams: b.Teams(), Byes: b.Byes()},
	})
	if err != nil {
		return apitypes.MockReport{}, err
	}
	final := in.Draft.State
	named := map[string]bool{}
	out := apitypes.MockReport{
		Teams: len(final.DraftOrder), Rounds: leagues.Rounds(in.Settings.League), Slot: in.Draft.Slot, Seed: int64(in.Seed),
		Settings: in.Settings.League, CouldWaitFrom: mock.CouldWaitFrom,
		Standings: make([]apitypes.ReportTeam, len(r.Standings)), Picks: make([]apitypes.ReportPick, len(r.Picks)),
	}
	for i, g := range r.Standings {
		out.Standings[i] = apitypes.ReportTeam{
			Seat: SeatNumber(final.DraftOrder, g.TeamID), Points: tenth.Round(g.ProjectedPoints), Rank: g.ProjectedRank,
			StartersFilled: g.StartingSlotsFilled, StartersTotal: g.StartingSlotsTotal, ByeCollisions: g.ByeCollisions,
			ValueCaptured: tenth.Round(g.ValueCaptured),
		}
	}
	ranks := boardRanks(b)
	for i, p := range r.Picks {
		out.Picks[i] = pickView(p, b, ranks)
		named[p.PlayerID] = true
	}
	out.Starters = starters(final, in.Draft.HumanTeamID, b.Points())
	for _, s := range out.Starters {
		if s.PlayerId != nil {
			named[*s.PlayerId] = true
		}
	}
	for _, slot := range draft.RosterFor(final, in.Draft.HumanTeamID) {
		named[slot.PlayerID] = true
	}
	out.Runs = runsView(r.Runs)
	for _, e := range out.Runs.Exposure {
		named[e.PlayerId] = true
	}
	out.Board = BoardView(b, named)
	out.ComputedMs = int(time.Since(began).Milliseconds())
	return out, nil
}

func pickView(p mock.PickReview, b boards.Board, ranks map[string]int) apitypes.ReportPick {
	v := apitypes.ReportPick{
		Pick: p.PickNumber, Round: p.Round, PlayerId: p.PlayerID, AdpGap: tenthp(p.ADPGap), Chip: apitypes.ReportPickChip(p.Chip),
		StillThere: chancep(p.StillThere), CouldWait: p.CouldWait, OddsSource: p.OddsSource,
		MadeBy: apitypes.ReportPickMadeBy(p.MadeBy),
	}
	if p.Chip == mock.NoADP {
		v.Chip = "none"
	}
	if value, ok := b.Values[p.PlayerID]; ok {
		r := tenth.Round(value)
		v.OverReplacement = &r
	}
	if rank, ok := ranks[p.PlayerID]; ok {
		v.BoardRank = &rank
	}
	return v
}

// boardRanks is each valued player's place on our board: the pool's
// order by points over replacement, most first, ties in pool (ADP) order,
// as the room ranks it. A player with no value (a kicker or a defense)
// has no place.
func boardRanks(b boards.Board) map[string]int {
	valued := make([]string, 0, len(b.Values))
	for _, p := range b.Raw.Players {
		if _, ok := b.Values[p.ID]; ok {
			valued = append(valued, p.ID)
		}
	}
	sort.SliceStable(valued, func(i, j int) bool { return b.Values[valued[i]] > b.Values[valued[j]] })
	ranks := make(map[string]int, len(valued))
	for i, id := range valued {
		ranks[id] = i + 1
	}
	return ranks
}

// starters is the drafter's best lineup by points, slot by slot in the
// order the league lists them, an open slot carrying no player.
func starters(final draft.State, team string, points map[string]float64) []apitypes.ReportStarter {
	var roster []sim.RosteredPlayer
	for _, slot := range draft.RosterFor(final, team) {
		if pos, ok := final.Pool.PositionOf(slot.PlayerID); ok {
			roster = append(roster, sim.RosteredPlayer{PlayerID: slot.PlayerID, Position: pos})
		}
	}
	lineup := sim.AssignStartingLineup(roster, final.Config.SlotConfig, points)
	bySlot := map[draft.SlotType][]string{}
	for i, id := range lineup.StarterIDs {
		bySlot[lineup.StarterSlots[i]] = append(bySlot[lineup.StarterSlots[i]], id)
	}
	var out []apitypes.ReportStarter
	for _, c := range final.Config.SlotConfig {
		if c.Slot == draft.SlotBench {
			continue
		}
		filled := bySlot[c.Slot]
		for unit := 0; unit < c.Count; unit++ {
			s := apitypes.ReportStarter{Slot: string(c.Slot)}
			if unit < len(filled) {
				id := filled[unit]
				s.PlayerId = &id
			}
			out = append(out, s)
		}
	}
	return out
}

func runsView(r mock.RunsSummary) apitypes.ReportRuns {
	out := apitypes.ReportRuns{
		Runs: r.Runs, Median: tenth.Round(r.Median), MiddleLow: tenth.Round(r.MiddleLow), MiddleHigh: tenth.Round(r.MiddleHigh),
		TopShare: r.TopShare, TopFinish: mock.TopFinish, RankCounts: r.RankCounts, Points: make([]float64, len(r.Points)),
	}
	for i, p := range r.Points {
		out.Points[i] = tenth.Round(p)
	}
	ids := make([]string, 0, len(r.PlayerShare))
	for id := range r.PlayerShare {
		ids = append(ids, id)
	}
	sort.SliceStable(ids, func(i, j int) bool {
		if r.PlayerShare[ids[i]] != r.PlayerShare[ids[j]] {
			return r.PlayerShare[ids[i]] > r.PlayerShare[ids[j]]
		}
		return jsmath.Collate(ids[i], ids[j]) < 0
	})
	for _, id := range ids[:min(exposureRows, len(ids))] {
		out.Exposure = append(out.Exposure, apitypes.ReportExposure{PlayerId: id, Share: r.PlayerShare[id]})
	}
	if out.Exposure == nil {
		out.Exposure = []apitypes.ReportExposure{}
	}
	return out
}
