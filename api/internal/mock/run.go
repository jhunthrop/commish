package mock

import (
	"fmt"
	"sort"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// HumanPick is one of the drafter's picks and when it was made.
type HumanPick struct {
	PlayerID string `json:"playerId"`
	At       string `json:"at"`
}

// Options are the drafter's standing instructions.
type Options struct {
	// Queue is set on the drafter's seat right after START_DRAFT.
	Queue []string
	// AutopickThroughRound makes the drafter's turns through this round,
	// past the picks given, the clock's pick: queue first, then the board
	// ("Pick for me to round N"; the last round is "Finish the draft").
	AutopickThroughRound int
}

// Draft is a mock as far as it goes: the log, the state it replays to,
// the drafter's seat and whether it waits on the drafter.
type Draft struct {
	Config      draft.Config   `json:"config"`
	Actions     []draft.Action `json:"actions"`
	State       draft.State    `json:"state"`
	HumanTeamID string         `json:"humanTeamId"`
	Slot        int            `json:"slot"`
	// Waiting is true when the drafter is on the clock with no pick given.
	Waiting bool `json:"waiting"`
}

// runner is one Run's working set.
type runner struct {
	settings Settings
	seed     uint32
	human    string
	dealt    map[string]bots.Archetype
	keepers  map[seatRound]string
	keeps    map[string]int
	strategy bots.Strategy
	actions  []draft.Action
	state    draft.State
}

// Config is the engine config a mock drafts under: no clock to speak of
// (the solo room has none) and no overnight freeze.
func Config(s Settings, seed uint32) (draft.Config, error) {
	slots, err := SlotConfig(s.League)
	if err != nil {
		return draft.Config{}, err
	}
	return draft.Config{
		DraftID: fmt.Sprintf("mock_%d", seed), LeagueID: "mock", Format: draft.Snake, KickoffAt: s.StartedAt,
		SlotConfig: slots, ClockSchedule: []draft.ClockTier{{UntilHoursBeforeKickoff: 0, PickSeconds: 0}}, IsMock: true,
	}, nil
}

// Run plays the mock from its settings, seed and the drafter's picks: every
// bot pick until the drafter's next turn resolves at once, stamped at the
// turn's own start (no think delay), so stamps never go backward. Bots
// draw from rngFor(seed, team), positioned by their own earlier draws:
// the mock room's replay law, so the same seed always drafts the same.
func Run(s Settings, seed uint32, picks []HumanPick, o Options) (Draft, error) {
	if errs := leagues.Validate(s.League, ""); errs != nil {
		return Draft{}, fmt.Errorf("mock: settings are not valid: %v", errs)
	}
	config, err := Config(s, seed)
	if err != nil {
		return Draft{}, err
	}
	slot := HumanSlot(s.League, seed)
	order := make([]string, s.League.Teams)
	for i := range order {
		order[i] = SeatID(i + 1)
	}
	r := newRunner(s, seed, SeatID(slot), order)
	if err := r.start(config, order, o.Queue); err != nil {
		return Draft{}, err
	}
	return r.finish(config, slot, picks, o.AutopickThroughRound)
}

// Advance is one pick on a mock the caller already holds: the drafter's
// pick and every bot pick to the next human turn, the batch the request
// returns being the actions after the ones d had. The same answer Run
// gives for the longer pick list, without replaying the bots before it.
func Advance(s Settings, seed uint32, d Draft, pick HumanPick, o Options) (Draft, error) {
	if !d.Waiting {
		return Draft{}, fmt.Errorf("mock: the draft is not waiting on you")
	}
	r := newRunner(s, seed, d.HumanTeamID, d.State.DraftOrder)
	r.state, r.actions = d.State, append([]draft.Action(nil), d.Actions...)
	r.keeps = keepsSoFar(r.keepers, d.State)
	return r.finish(d.Config, d.Slot, []HumanPick{pick}, o.AutopickThroughRound)
}

func newRunner(s Settings, seed uint32, human string, order []string) *runner {
	botIDs := make([]string, 0, len(order))
	for _, team := range order {
		if team != human {
			botIDs = append(botIDs, team)
		}
	}
	sort.Strings(botIDs)
	return &runner{
		settings: s, seed: seed, human: human, strategy: bots.DefaultStrategy(), keeps: map[string]int{},
		dealt: bots.AssignArchetypes(seed, botIDs), keepers: keeperMap(s),
	}
}

func (r *runner) finish(config draft.Config, slot int, picks []HumanPick, autopickThrough int) (Draft, error) {
	waiting, err := r.play(picks, autopickThrough)
	if err != nil {
		return Draft{}, err
	}
	return Draft{Config: config, Actions: r.actions, State: r.state, HumanTeamID: r.human, Slot: slot, Waiting: waiting}, nil
}

// keepsSoFar counts each seat's keeper picks already in the state.
func keepsSoFar(keepers map[seatRound]string, s draft.State) map[string]int {
	out := map[string]int{}
	for _, p := range s.Picks {
		if keepers[seatRound{p.TeamID, p.Round}] == p.PlayerID {
			out[p.TeamID]++
		}
	}
	return out
}

// Undo is the mock with the drafter's pick at index (0-based) and every
// later one taken back: the same seed, so the bots draft the same up to it.
func Undo(s Settings, seed uint32, picks []HumanPick, index int, o Options) (Draft, error) {
	if index < 0 || index >= len(picks) {
		return Draft{}, fmt.Errorf("mock: no pick %d to undo", index)
	}
	o.AutopickThroughRound = 0
	return Run(s, seed, picks[:index], o)
}

// seatRound names one seat's pick in one round.
type seatRound struct {
	team  string
	round int
}

func keeperMap(s Settings) map[seatRound]string {
	out := map[seatRound]string{}
	for _, k := range s.League.Keepers {
		out[seatRound{SeatID(k.Slot), k.Round}] = k.PlayerId
	}
	return out
}

func (r *runner) apply(a draft.Action) error {
	next, err := draft.Submit(r.state, a)
	if err != nil {
		return err
	}
	r.state = next
	r.actions = append(r.actions, a)
	return nil
}

func (r *runner) start(config draft.Config, order []string, queue []string) error {
	autopick := draft.AutopickConfig()
	skip := draft.DraftSkipPolicy()
	r.state = draft.Initial(config)
	start := draft.Action{
		Type: draft.StartDraft, Timestamp: r.settings.StartedAt, DraftOrder: order, Pool: r.settings.Pool,
		MinBid: draft.AuctionMinBid, SkipPolicy: &skip, Autopick: &autopick,
	}
	if err := r.apply(start); err != nil {
		return fmt.Errorf("mock: start: %w", err)
	}
	if len(queue) > 0 {
		if err := r.apply(draft.NewSetQueue(r.settings.StartedAt, r.human, queue)); err != nil {
			return fmt.Errorf("mock: queue: %w", err)
		}
	}
	return nil
}

func (r *runner) turnStamp() string {
	if r.state.TurnStartedAt != nil {
		return *r.state.TurnStartedAt
	}
	return r.settings.StartedAt
}

// play resolves turns until the drafter is on the clock with nothing to
// play, a bot can take nobody, or the draft ends. It reports whether it
// stopped on the drafter.
func (r *runner) play(picks []HumanPick, autopickThrough int) (bool, error) {
	next := 0
	for r.state.Phase == draft.PhaseInProgress {
		team, ok := draft.TeamOnClock(r.state)
		if !ok {
			return false, nil
		}
		round := draft.RoundForPick(len(r.state.DraftOrder), r.state.PickNumber)
		if keeper, kept := r.keepers[seatRound{team, round}]; kept {
			if err := r.apply(draft.NewMakePick(r.turnStamp(), team, keeper)); err != nil {
				return false, fmt.Errorf("mock: keeper %s for %s in round %d: %w", keeper, team, round, err)
			}
			r.keeps[team]++
			continue
		}
		if team != r.human {
			picked, err := r.botPick(team)
			if err != nil || !picked {
				return false, err
			}
			continue
		}
		switch {
		case next < len(picks):
			if err := r.humanPick(team, picks[next]); err != nil {
				return false, fmt.Errorf("mock: your pick %d: %w", next+1, err)
			}
			next++
		case round <= autopickThrough:
			best, ok := draft.BestAvailableFor(r.state, team)
			if !ok {
				return true, nil
			}
			if err := r.apply(draft.NewMakePick(r.turnStamp(), team, best.PlayerID)); err != nil {
				return false, fmt.Errorf("mock: pick for me: %w", err)
			}
		default:
			return true, nil
		}
	}
	if next < len(picks) {
		return false, fmt.Errorf("mock: %d of your picks came after the draft ended", len(picks)-next)
	}
	return false, nil
}

// humanPick stamps the drafter's pick at its own time, or at the turn's
// start if it claims to be earlier, so the log stays monotone.
func (r *runner) humanPick(team string, p HumanPick) error {
	stamp := r.turnStamp()
	if p.At != "" {
		at, err := draft.ParseMillis(p.At)
		if err != nil {
			return err
		}
		start, err := draft.ParseMillis(stamp)
		if err != nil {
			return err
		}
		if at >= start {
			stamp = p.At
		}
	}
	return r.apply(draft.NewMakePick(stamp, team, p.PlayerID))
}

// botPick is one bot's pick from its own stream; false when the bot can
// take nobody, which leaves the turn open.
func (r *runner) botPick(team string) (bool, error) {
	rng := bots.RngFor(r.seed, bots.PickStreamKey(team))
	prior := -r.keeps[team]
	for _, p := range r.state.Picks {
		if p.TeamID == team && !p.Auto {
			prior++
		}
	}
	for i := 0; i < prior; i++ {
		rng.Next()
	}
	playerID, ok := bots.ChooseBotPick(r.state, team, r.dealt[team], r.strategy, rng)
	if !ok {
		return false, nil
	}
	if err := r.apply(draft.NewMakePick(r.turnStamp(), team, playerID)); err != nil {
		return false, fmt.Errorf("mock: bot %s at pick %d: %w", team, r.state.PickNumber, err)
	}
	return true, nil
}
