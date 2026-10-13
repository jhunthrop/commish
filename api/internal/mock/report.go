package mock

import (
	"context"
	"fmt"
	"math"
	"sort"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// The report's thresholds (room doc, the report).
const (
	// AtADPWithin is the gap, in picks, still read as "at ADP".
	AtADPWithin = 3
	// CouldWaitFrom is the survival at which a pick "could wait".
	CouldWaitFrom = 0.6
	// MiddleShare is the middle band of the runs the page shows (80%).
	MiddleShare = 0.8
	// TopFinish is the rank a "top three" finish is counted to.
	TopFinish = 3
)

// Odds is the hindsight survival for a pick: the chance each player
// would still be there at the seat's next turn, from the room as it stood.
// The advisor service answers it at launch; SimOdds is the engine's own.
type Odds interface {
	Survival(ctx context.Context, s draft.State, teamID string, passedOn string) (map[string]float64, error)
}

// Board is what the report reads about players: points, value over
// replacement, ADP, NFL team, and the bye weeks.
type Board struct {
	Points   map[string]float64
	Values   map[string]float64
	ADP      map[string]float64
	NFLTeams map[string]string
	Byes     map[string]int
}

// ReportInput is a finished mock and what the report reads beside it.
type ReportInput struct {
	Settings Settings
	Seed     uint32
	Draft    Draft
	Board    Board
	Odds     Odds
	Runs     int
	Workers  int
}

// ADPChip is how a pick sits against where drafters take him.
type ADPChip string

// The three chips, and none when the player has no ADP.
const (
	Reach ADPChip = "reach"
	Steal ADPChip = "steal"
	AtADP ADPChip = "at_adp"
	NoADP ADPChip = ""
)

// noValue is a summary over no runs.
const noValue = 0

// PickReview is one of the drafter's picks with its hindsight.
type PickReview struct {
	PickNumber int            `json:"pickNumber"`
	Round      int            `json:"round"`
	PlayerID   string         `json:"playerId"`
	Position   draft.Position `json:"position"`
	// OverReplacement is the board's value over replacement.
	OverReplacement float64 `json:"overReplacement"`
	// ADPGap is ADP less the pick: positive took him before drafters do.
	ADPGap *float64 `json:"adpGap"`
	Chip   ADPChip  `json:"chip"`
	// StillThere is the chance he was there at the next turn; nil at the last.
	StillThere *float64 `json:"stillThere"`
	CouldWait  bool     `json:"couldWait"`
}

// RunsSummary is "the same draft, 200 more times".
type RunsSummary struct {
	Runs int `json:"runs"`
	// Points is the drafter's starting points per run, ascending.
	Points      []float64          `json:"points"`
	Median      float64            `json:"median"`
	MiddleLow   float64            `json:"middleLow"`
	MiddleHigh  float64            `json:"middleHigh"`
	TopShare    float64            `json:"topShare"`
	RankCounts  []int              `json:"rankCounts"`
	PlayerShare map[string]float64 `json:"playerShare"`
}

// Report is the report page's inputs.
type Report struct {
	Standings []sim.TeamGrade `json:"standings"`
	Picks     []PickReview    `json:"picks"`
	Runs      RunsSummary     `json:"runs"`
}

// BuildReport reads a finished mock: the standings, the drafter's picks
// with hindsight, and the runs.
func BuildReport(ctx context.Context, in ReportInput) (Report, error) {
	final := in.Draft.State
	if !draft.IsComplete(final) {
		return Report{}, fmt.Errorf("mock: the report needs a finished draft")
	}
	standings := sim.Grade(sim.GradeInputFor(final, in.Board.Points, in.Board.Values, in.Board.Byes, in.Board.NFLTeams))
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].ProjectedRank < standings[j].ProjectedRank })
	picks, err := reviewPicks(ctx, in)
	if err != nil {
		return Report{}, err
	}
	runs, err := runReport(ctx, in)
	if err != nil {
		return Report{}, err
	}
	return Report{Standings: standings, Picks: picks, Runs: runs}, nil
}

func chipFor(gap float64) ADPChip {
	switch {
	case math.Abs(gap) < AtADPWithin:
		return AtADP
	case gap > 0:
		return Reach
	default:
		return Steal
	}
}

// reviewPicks walks the log: before each of the drafter's picks, the room
// as it stood asks the odds whether he would have lasted.
func reviewPicks(ctx context.Context, in ReportInput) ([]PickReview, error) {
	human := in.Draft.HumanTeamID
	s := draft.Initial(in.Draft.Config)
	var out []PickReview
	for _, a := range in.Draft.Actions {
		if a.Type == draft.MakePick && a.TeamID == human && s.PickNumber <= draft.TotalPickCount(s) {
			review, err := reviewOne(ctx, in, s, a.PlayerID)
			if err != nil {
				return nil, err
			}
			out = append(out, review)
		}
		next, err := draft.Reduce(s, a)
		if err != nil {
			return nil, fmt.Errorf("mock: replay for the report: %w", err)
		}
		s = next
	}
	return out, nil
}

func reviewOne(ctx context.Context, in ReportInput, before draft.State, playerID string) (PickReview, error) {
	pos, _ := before.Pool.PositionOf(playerID)
	r := PickReview{
		PickNumber: before.PickNumber, Round: draft.RoundForPick(len(before.DraftOrder), before.PickNumber),
		PlayerID: playerID, Position: pos, OverReplacement: in.Board.Values[playerID],
	}
	if adp, ok := in.Board.ADP[playerID]; ok {
		gap := adp - float64(before.PickNumber)
		r.ADPGap, r.Chip = &gap, chipFor(gap)
	}
	if _, hasNext := sim.NextTurnFor(before, in.Draft.HumanTeamID); !hasNext || in.Odds == nil {
		return r, nil
	}
	odds, err := in.Odds.Survival(ctx, before, in.Draft.HumanTeamID, playerID)
	if err != nil {
		return PickReview{}, fmt.Errorf("mock: odds at pick %d: %w", before.PickNumber, err)
	}
	if p, ok := odds[playerID]; ok {
		r.StillThere, r.CouldWait = &p, p >= CouldWaitFrom
	}
	return r, nil
}

// runReport is the room from pick one, the drafter's seat on the clock's
// own policy, the bots reshuffled every run (seed + run), each graded.
func runReport(ctx context.Context, in ReportInput) (RunsSummary, error) {
	runs := in.Runs
	if runs == 0 {
		runs = sim.RoomOddsRuns
	}
	started, err := draft.Replay(in.Draft.Config, in.Draft.Actions[:1])
	if err != nil {
		return RunsSummary{}, err
	}
	human := in.Draft.HumanTeamID
	results, err := sim.RunMany(ctx, sim.ManyInput{
		State: started, Seed: in.Seed, Runs: runs, ThroughPick: draft.TotalPickCount(started),
		Drivers: sim.Drivers{human: {Kind: sim.DriveAutopick}}, Strategy: bots.DefaultStrategy(), Workers: in.Workers,
	})
	if err != nil {
		return RunsSummary{}, err
	}
	summary := RunsSummary{Runs: runs, RankCounts: make([]int, len(started.DraftOrder)), PlayerShare: map[string]float64{}}
	held := map[string]int{}
	top := 0
	for _, r := range results {
		for _, g := range sim.Grade(sim.GradeInputFor(r.Final, in.Board.Points, in.Board.Values, in.Board.Byes, in.Board.NFLTeams)) {
			if g.TeamID != human {
				continue
			}
			summary.Points = append(summary.Points, g.ProjectedPoints)
			summary.RankCounts[g.ProjectedRank-1]++
			if g.ProjectedRank <= TopFinish {
				top++
			}
		}
		for _, slot := range draft.RosterFor(r.Final, human) {
			held[slot.PlayerID]++
		}
	}
	sort.Float64s(summary.Points)
	summary.Median = quantile(summary.Points, 0.5)
	summary.MiddleLow = quantile(summary.Points, (1-MiddleShare)/2)
	summary.MiddleHigh = quantile(summary.Points, 1-(1-MiddleShare)/2)
	summary.TopShare = float64(top) / float64(runs)
	for id, n := range held {
		summary.PlayerShare[id] = float64(n) / float64(runs)
	}
	return summary, nil
}

// quantile is the nearest-rank quantile of an ascending list.
func quantile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return noValue
	}
	i := int(math.Ceil(q*float64(len(sorted)))) - 1
	return sorted[min(max(i, 0), len(sorted)-1)]
}

// SimOdds answers Odds with the engine's own room odds: the seats read by
// the seat model, the pick being judged held back from the drafter's turn.
type SimOdds struct {
	Seed    uint32
	Runs    int
	Workers int
}

// Survival is the share of runs each player lasted to the next turn.
func (o SimOdds) Survival(ctx context.Context, s draft.State, teamID string, passedOn string) (map[string]float64, error) {
	strategy := bots.DefaultStrategy()
	table, err := sim.SimulateRoomOdds(ctx, sim.RoomOddsInput{
		State: s, Seed: o.Seed, Runs: o.Runs, Drivers: sim.InferSeatDrivers(s, strategy, sim.DefaultSeatModel()),
		ExcludeFromOnClockSeat: map[string]bool{passedOn: true}, Strategy: strategy, Workers: o.Workers,
	})
	if err != nil {
		return nil, err
	}
	survival, ok := sim.SurvivalFor(table, s, teamID)
	out := map[string]float64{}
	if !ok || survival.RunsReached == 0 {
		return out, nil
	}
	for id, n := range survival.Survived {
		out[id] = float64(n) / float64(survival.RunsReached)
	}
	return out, nil
}
