package hostmoves

import (
	"errors"
	"fmt"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
)

// espnSlot is a lineup row's slot as ESPN's lineupSlotId (espn.SlotID):
// every slot of a kind is one id on ESPN, so a row's place needs no
// number. Our superflex is ESPN's SUPER_FLEX.
func espnSlot(slot apitypes.HostMoveChangeSlot) (int, bool) {
	if !slot.Valid() {
		return 0, false
	}
	name := string(slot)
	if slot == apitypes.HostMoveChangeSlotSUPERFLEX {
		name = "SUPER_FLEX"
	}
	return espn.SlotID(name)
}

// slotPlace is where a change goes in a sentence: "at RB", "in the flex".
func slotPlace(slot apitypes.HostMoveChangeSlot) string {
	switch slot {
	case apitypes.HostMoveChangeSlotFLEX:
		return "in the flex"
	case apitypes.HostMoveChangeSlotSUPERFLEX:
		return "in the superflex"
	}
	return "at " + string(slot)
}

// refusal is a move we refuse before anything is sent, with the member's
// sentence for it.
type refusal struct {
	words string
	cause error
	// unavailable is a move this member cannot make here at all (the team
	// is not theirs on ESPN): the host's page, not a refusal to fix.
	unavailable bool
}

func (r *refusal) Error() string { return r.cause.Error() }
func (r *refusal) Unwrap() error { return r.cause }

func refuse(words string, cause error) error { return &refusal{words: words, cause: cause} }

// notTheirs is the move on a team ESPN does not list as the member's.
func notTheirs(cause error) error {
	return &refusal{words: espnWords.notYourTeam, cause: cause, unavailable: true}
}

// lineupPlan is a lineup move checked against a fresh read: the set ESPN
// takes and the move in words.
type lineupPlan struct {
	set      espn.LineupSet
	sentence string
}

// planLineup turns the screen's changes into ESPN's items on the member's
// own team: each change's player in takes the slot, the starter out goes
// to the bench unless another change starts him, and only players whose
// slot changes are sent. The week must be ESPN's current one, every slot
// must hold no more than the league allows, and espn.OwnLineup checks the
// team, the locks and the eligibility.
func planLineup(l espn.FullLeague, swid string, me int, mv apitypes.HostMoveInput) (lineupPlan, error) {
	if mv.Week != l.ScoringPeriod {
		return lineupPlan{}, refuse(fmt.Sprintf(espnWords.weekMoved, l.ScoringPeriod), fmt.Errorf("week %d is not ESPN's %d", mv.Week, l.ScoringPeriod))
	}
	team, ok := teamOf(l, me)
	if !ok {
		return lineupPlan{}, notTheirs(espn.ErrNotYourTeam)
	}
	roster := map[string]espn.Player{}
	for _, p := range team.Roster {
		roster[p.ID] = p
	}
	targets, order, err := targetsOf(mv.Changes, roster)
	if err != nil {
		return lineupPlan{}, err
	}
	if err := fits(team.Roster, targets, l.LineupSlotCount); err != nil {
		return lineupPlan{}, err
	}
	items := make([]espn.LineupItem, 0, len(order))
	for _, id := range order {
		if from := roster[id].Slot; from != targets[id] {
			items = append(items, espn.LineupItem{PlayerID: id, From: from, To: targets[id]})
		}
	}
	set, err := espn.OwnLineup(l, swid, me, items)
	if err != nil {
		return lineupPlan{}, ownRefusal(err, items, roster)
	}
	return lineupPlan{set: set, sentence: lineupWords(mv.Changes, roster)}, nil
}

func teamOf(l espn.FullLeague, id int) (espn.Team, bool) {
	for _, t := range l.Teams {
		if t.ID == id {
			return t, true
		}
	}
	return espn.Team{}, false
}

// targetsOf is each moved player's new slot, in the order the changes
// name them: a player in takes the change's slot, a starter out who is
// in no change goes to the bench. A player out must be in the change's
// slot on ESPN now, so a screen read before a change on ESPN cannot move
// someone it did not mean to.
func targetsOf(changes []apitypes.HostMoveChange, roster map[string]espn.Player) (map[string]int, []string, error) {
	targets, outs := map[string]int{}, map[string]bool{}
	var order []string
	for _, c := range changes {
		slot, ok := espnSlot(c.Slot)
		p, on := roster[c.In]
		switch {
		case !ok:
			return nil, nil, refuse(espnWords.stale, fmt.Errorf("slot %q", c.Slot))
		case !on:
			return nil, nil, refuse(espnWords.stale, fmt.Errorf("player %s is not on the team", c.In))
		case p.Slot == espn.SlotReserve:
			return nil, nil, refuse(fmt.Sprintf(espnWords.reserve, p.Name), fmt.Errorf("player %s is on injured reserve", c.In))
		}
		if _, twice := targets[c.In]; twice {
			return nil, nil, refuse(espnWords.stale, fmt.Errorf("player %s starts twice", c.In))
		}
		targets[c.In] = slot
		order = append(order, c.In)
	}
	for _, c := range changes {
		if c.Out == nil {
			continue
		}
		p, on := roster[*c.Out]
		at, _ := espnSlot(c.Slot)
		if !on || p.Slot != at || outs[*c.Out] {
			return nil, nil, refuse(espnWords.stale, fmt.Errorf("player %s is not at %s", *c.Out, c.Slot))
		}
		outs[*c.Out] = true
		if _, starts := targets[*c.Out]; !starts {
			targets[*c.Out] = espn.SlotBench
			order = append(order, *c.Out)
		}
	}
	return targets, order, nil
}

// fits checks no slot holds more players after the move than the league
// allows.
func fits(roster []espn.Player, targets map[string]int, counts map[int]int) error {
	after := map[int]int{}
	for _, p := range roster {
		slot := p.Slot
		if to, moved := targets[p.ID]; moved {
			slot = to
		}
		after[slot]++
	}
	for _, to := range targets {
		if after[to] > counts[to] {
			return refuse(espnWords.stale, fmt.Errorf("slot %d holds %d of %d", to, after[to], counts[to]))
		}
	}
	return nil
}

// ownRefusal is the member's sentence for a move espn.OwnLineup refused.
func ownRefusal(err error, items []espn.LineupItem, roster map[string]espn.Player) error {
	if errors.Is(err, espn.ErrNotYourTeam) {
		return notTheirs(err)
	}
	var locked, cannot []string
	for _, it := range items {
		p := roster[it.PlayerID]
		if p.Locked {
			locked = append(locked, p.Name)
		}
		if !espn.CanFill(p, it.To) {
			cannot = append(cannot, p.Name)
		}
	}
	switch {
	case len(locked) > 0:
		return refuse(fmt.Sprintf(espnWords.lockedPlayers, andNames(locked), verbFor(len(locked))), err)
	case len(cannot) > 0:
		return refuse(fmt.Sprintf(espnWords.cannotFill, andNames(cannot)), err)
	}
	return refuse(espnWords.stale, err)
}

func verbFor(n int) string {
	if n == 1 {
		return "game has"
	}
	return "games have"
}

// lineupWords is the ESPN move as the member confirms it, each player
// named as the roster names him.
func lineupWords(changes []apitypes.HostMoveChange, roster map[string]espn.Player) string {
	return lineupSentence(changes, func(id string) string { return roster[id].Name }, espnWords)
}
