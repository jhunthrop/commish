package draft

import "fmt"

// Refusal is a rule's answer to an action that does not apply, worded for
// the drafter. Every other error from this package is a defect.
type Refusal struct{ Reason string }

func (r *Refusal) Error() string { return r.Reason }

func refuse(reason string) error { return &Refusal{Reason: reason} }

// pickInput is applyPick's input. pickNumber zero means the current pick;
// a redeemed owed pick names the pick it fills.
type pickInput struct {
	teamID, playerID, timestamp string
	price                       *int
	auto                        bool
	pickNumber                  int
}

// refusalFor names what a bench-full roster can still take, or keeps the
// slotting oracle's own words.
func refusalFor(s State, roster []RosterSlot, slottingReason string) string {
	owed := RestrictedPositions(s.Config.SlotConfig, roster)
	if len(owed) == 0 {
		return slottingReason
	}
	return MustPickLine(owed)
}

// draftedSet is the ids already picked.
func draftedSet(s State) map[string]bool {
	out := make(map[string]bool, len(s.Picks))
	for _, p := range s.Picks {
		out[p.PlayerID] = true
	}
	return out
}

func isDrafted(s State, playerID string) bool {
	for _, p := range s.Picks {
		if p.PlayerID == playerID {
			return true
		}
	}
	return false
}

// applyPick records a pick and its roster slot. It does not advance the turn.
func applyPick(s State, in pickInput) (State, error) {
	entry, _, ok := s.Pool.Lookup(in.playerID)
	if !ok {
		return State{}, refuse("That player isn't in this draft's player pool.")
	}
	if isDrafted(s, in.playerID) {
		return State{}, refuse("That player has already been drafted.")
	}
	roster := RosterFor(s, in.teamID)
	a := AssignSlot(entry.Position, roster, s.Config.SlotConfig)
	if !a.OK {
		return State{}, refuse(refusalFor(s, roster, a.Reason))
	}
	pickNumber := in.pickNumber
	if pickNumber == 0 {
		pickNumber = s.PickNumber
	}
	round := 0
	if s.Config.Format == Snake {
		round = RoundForPick(len(s.DraftOrder), pickNumber)
	} else {
		round = countPicksBy(s, in.teamID) + 1
	}
	pick := Pick{
		PickNumber: pickNumber, Round: round, TeamID: in.teamID, PlayerID: in.playerID,
		Slot: a.Slot, SlotIndex: a.SlotIndex, Price: in.price, Timestamp: in.timestamp, Auto: in.auto,
	}
	next := s
	next.Picks = appendPick(s.Picks, pick)
	slots := make([]RosterSlot, len(roster), len(roster)+1)
	copy(slots, roster)
	next.Rosters = withRoster(s.Rosters, in.teamID, append(slots, RosterSlot{Slot: a.Slot, SlotIndex: a.SlotIndex, PlayerID: in.playerID}))
	return next, nil
}

func countPicksBy(s State, teamID string) int {
	n := 0
	for _, p := range s.Picks {
		if p.TeamID == teamID {
			n++
		}
	}
	return n
}

// mustApply unwraps a pick the caller has proven legal; a refusal here is
// a broken invariant, never a drafter's mistake.
func mustApply(s State, err error, invariant string) (State, error) {
	if err != nil {
		return State{}, fmt.Errorf("draft engine invariant violated (%s): %w", invariant, err)
	}
	return s, nil
}

// redeemOwedPick fills the earliest pick teamID was skipped at and drops
// it from OwedPicks, removing the team's key once its list is empty.
func redeemOwedPick(s State, teamID, playerID string, auto bool, timestamp string) (State, error) {
	owed := s.OwedPicks[teamID]
	if len(owed) == 0 {
		return State{}, refuse("This team doesn't owe a pick.")
	}
	if isDrafted(s, playerID) {
		return State{}, refuse("Somebody already drafted that player. Pick another.")
	}
	applied, err := applyPick(s, pickInput{teamID: teamID, playerID: playerID, auto: auto, timestamp: timestamp, pickNumber: owed[0]})
	if err != nil {
		return State{}, err
	}
	owedPicks := make(map[string][]int, len(s.OwedPicks))
	for k, v := range s.OwedPicks {
		if k != teamID {
			owedPicks[k] = v
		}
	}
	if rest := owed[1:]; len(rest) > 0 {
		owedPicks[teamID] = append([]int{}, rest...)
	}
	applied.OwedPicks = owedPicks
	return applied, nil
}
