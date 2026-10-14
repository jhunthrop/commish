package companion

import (
	"errors"
	"fmt"
	"sort"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// unplacedPrefix marks a pool entry that stands in for a host pick we
// could not place on our board: it fills the drafting seat's roster at
// the host's position and takes nobody from our pool.
const unplacedPrefix = "host:"

// Placed is one host pick as the companion read it.
type Placed struct {
	Pick sleeper.Pick
	// PlayerID is our board's player, empty when the pick is unplaced.
	PlayerID string
	// How is the match rule that placed him, empty when unplaced.
	How string
}

// Built is the draft as far as the host has gone, replayed on our
// engine: every host pick applied in pick order as its seat's forced
// pick.
type Built struct {
	Draft  mock.Draft
	Placed []Placed
	// Unplaced counts the picks we could not place on our board.
	Unplaced int
	// PlacedByName counts the Sleeper picks placed by exact name, position
	// and team because our players do not carry their Sleeper id yet.
	PlacedByName int
	// LostAt is the pick our engine could not follow (a pick out of
	// order, or one no roster slot takes), nil while it follows them all.
	LostAt *int
}

// stamp is every action's timestamp: the companion has no clock.
const stamp = "2026-08-15T18:00:00.000Z"

func positionOK(p draft.Position) bool { return p.Valid() }

// standIns are the pool entries for the picks no board player matches.
func standIns(picks []sleeper.Pick, ids map[int]string) []draft.PoolEntry {
	var out []draft.PoolEntry
	for _, p := range picks {
		if ids[p.PickNo] != "" {
			continue
		}
		if pos := hostPosition(p.Position); positionOK(pos) {
			out = append(out, draft.PoolEntry{PlayerID: unplacedPrefix + p.PlayerID, Position: pos, ExcludedFromAutopick: true})
		}
	}
	return out
}

// maxRefits bounds how many picks one build re-slots: each refit is one
// pick the host let a team make past its starters.
const maxRefits = 32

// Build replays the host's picks on our engine for a league valued on
// board. seat is the drafter's 1-based slot.
//
// A host may let a team draft past an open starter (a QB in the last
// round with the defense still open), which our engine refuses. That
// pick is replayed again with the player standing at the open slot's
// position: he leaves the pool, the seat's roster stays the host's
// count, and nothing else moves.
func Build(settings mock.Settings, raw *boards.Raw, seat int, picks []sleeper.Pick, m Matcher) (Built, error) {
	sorted := append([]sleeper.Pick(nil), picks...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PickNo < sorted[j].PickNo })
	ids := map[int]string{}
	how := map[int]string{}
	used := map[string]bool{}
	for _, p := range sorted {
		if id, rule, found := m.Match(raw, p); found && !used[id] {
			ids[p.PickNo], how[p.PickNo], used[id] = id, rule, true
		}
	}
	refit := map[string]draft.Position{}
	for range maxRefits {
		out, misfit, err := replayOnce(settings, seat, sorted, ids, how, refit)
		if err != nil || misfit == nil {
			return out, err
		}
		refit[misfit.playerID] = misfit.fits
	}
	return Built{}, fmt.Errorf("companion: more than %d picks past their starters", maxRefits)
}

// misfit is a host pick no slot of its seat's roster takes, and the
// position of the slot still open.
type misfit struct {
	playerID string
	fits     draft.Position
}

func poolFor(settings mock.Settings, sorted []sleeper.Pick, ids map[int]string, refit map[string]draft.Position) []draft.PoolEntry {
	pool := append(append([]draft.PoolEntry(nil), settings.Pool...), standIns(sorted, ids)...)
	for i, e := range pool {
		if pos, ok := refit[e.PlayerID]; ok {
			pool[i].Position = pos
		}
	}
	return pool
}

func replayOnce(settings mock.Settings, seat int, sorted []sleeper.Pick, ids, how map[int]string, refit map[string]draft.Position) (Built, *misfit, error) {
	s := settings
	s.Pool = poolFor(settings, sorted, ids, refit)
	s.StartedAt = stamp
	config, err := mock.Config(s, 0)
	if err != nil {
		return Built{}, nil, err
	}
	order := make([]string, s.League.Teams)
	for i := range order {
		order[i] = mock.SeatID(i + 1)
	}
	autopick, skip := draft.AutopickConfig(), draft.DraftSkipPolicy()
	start := draft.Action{
		Type: draft.StartDraft, Timestamp: stamp, DraftOrder: order, Pool: s.Pool,
		MinBid: draft.AuctionMinBid, SkipPolicy: &skip, Autopick: &autopick,
	}
	state, err := draft.Submit(draft.Initial(config), start)
	if err != nil {
		return Built{}, nil, fmt.Errorf("companion: start: %w", err)
	}
	out := Built{Draft: mock.Draft{
		Config: config, Actions: []draft.Action{start}, HumanTeamID: mock.SeatID(seat), Slot: seat,
	}}
	for _, p := range sorted {
		placed := Placed{Pick: p, PlayerID: ids[p.PickNo], How: how[p.PickNo]}
		switch {
		case placed.PlayerID == "":
			out.Unplaced++
		case placed.How == MatchSleeperName:
			out.PlacedByName++
		}
		next, action, err := apply(state, p, placed.PlayerID)
		if err != nil {
			var refusal *draft.Refusal
			if !errors.As(err, &refusal) {
				return Built{}, nil, err
			}
			if fits, ok := openPosition(state, mock.SeatID(p.Slot)); ok && p.PickNo == state.PickNumber {
				if _, done := refit[action.PlayerID]; !done {
					return Built{}, &misfit{playerID: action.PlayerID, fits: fits}, nil
				}
			}
			at := p.PickNo
			out.LostAt = &at
			break
		}
		state = next
		out.Draft.Actions = append(out.Draft.Actions, action)
		out.Placed = append(out.Placed, placed)
	}
	out.Draft.State = state
	team, onClock := draft.TeamOnClock(state)
	out.Draft.Waiting = onClock && team == out.Draft.HumanTeamID
	return out, nil, nil
}

// openPosition is a position the seat's roster still has a slot for:
// the first slot, in the engine's fill order, with room.
func openPosition(s draft.State, team string) (draft.Position, bool) {
	filled := map[draft.SlotType]int{}
	for _, r := range draft.RosterFor(s, team) {
		filled[r.Slot]++
	}
	for _, c := range s.Config.SlotConfig {
		if filled[c.Slot] < c.Count && len(c.EligiblePositions) > 0 {
			return c.EligiblePositions[0], true
		}
	}
	return "", false
}

// apply makes one host pick its seat's pick on our engine: the matched
// player, or the stand-in for an unplaced one. The action is returned
// even when the engine refuses it, so the caller can name the player.
func apply(s draft.State, p sleeper.Pick, playerID string) (draft.State, draft.Action, error) {
	id := playerID
	if id == "" {
		id = unplacedPrefix + p.PlayerID
	}
	a := draft.NewMakePick(stamp, mock.SeatID(p.Slot), id)
	if p.PickNo != s.PickNumber {
		return draft.State{}, a, &draft.Refusal{Reason: fmt.Sprintf("pick %d arrived at pick %d", p.PickNo, s.PickNumber)}
	}
	next, err := draft.Submit(s, a)
	return next, a, err
}
