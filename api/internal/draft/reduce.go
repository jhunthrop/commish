package draft

import "fmt"

// Reduce applies one action. Pure: no clock, no I/O, the input never
// written. On success the new state's Sequence is exactly one higher. A
// *Refusal error is a rule's answer to the action; any other error is a
// defect.
func Reduce(s State, a Action) (State, error) {
	allowedWhileScheduled := a.Type == StartDraft || a.Type == SetQueue
	if s.Phase == PhaseScheduled && !allowedWhileScheduled {
		return State{}, refuse("This draft hasn't started yet.")
	}
	if s.Phase == PhaseComplete {
		return State{}, refuse("This draft has already finished.")
	}
	next, err := dispatch(s, a)
	if err != nil {
		return State{}, err
	}
	next.Sequence = s.Sequence + 1
	return next, nil
}

func dispatch(s State, a Action) (State, error) {
	switch a.Type {
	case StartDraft:
		return reduceStart(s, a)
	case SetQueue:
		return reduceSetQueue(s, a)
	case MakePick:
		return reduceMakePick(s, a)
	case Nominate:
		auction := AuctionOf(s)
		if auction == nil {
			return State{}, refuse("This is a snake draft. Make a pick instead of nominating.")
		}
		return reduceNominate(s, *auction, a)
	case Bid:
		auction := AuctionOf(s)
		if auction == nil {
			return State{}, refuse("This is a snake draft. There's nothing to bid on.")
		}
		return reduceBid(s, *auction, a)
	case TimerExpire:
		// "The clock has run out" reads the schedule, a tunable, so it is
		// Admit's check and is not re-applied on replay.
		auction := AuctionOf(s)
		if auction == nil {
			return reduceSnakeExpiry(s, a.Timestamp)
		}
		return reduceAuctionExpiry(s, *auction, a.Timestamp)
	}
	return State{}, fmt.Errorf("draft: unknown action type %q", a.Type)
}

func reduceStart(s State, a Action) (State, error) {
	if s.Phase != PhaseScheduled {
		return State{}, refuse("This draft has already started.")
	}
	if len(a.DraftOrder) < 2 {
		return State{}, refuse("A draft needs at least two teams.")
	}
	if hasDuplicate(a.DraftOrder) {
		return State{}, refuse("Every team may appear in the draft order only once.")
	}
	ids := make([]string, len(a.Pool))
	for i, e := range a.Pool {
		ids[i] = e.PlayerID
	}
	if hasDuplicate(ids) {
		return State{}, refuse("Every player may appear in the draft pool only once.")
	}
	if len(a.Pool) < len(a.DraftOrder)*TotalRosterSlots(s.Config.SlotConfig) {
		return State{}, refuse("There aren't enough players to fill every roster.")
	}
	isAuction := s.Config.Format == Auction
	budget := s.Config.AuctionBudget
	if isAuction && (budget == nil || *budget <= 0) {
		return State{}, refuse("An auction draft needs a budget before it can start.")
	}
	next := s
	next.Phase = PhaseInProgress
	// The one reducer-side read of a policy: it reads the ACTION, this
	// draft's own frozen history, never a package constant.
	next.Config.SkipPolicy, next.Config.Autopick = a.SkipPolicy, a.Autopick
	next.DraftOrder = append([]string{}, a.DraftOrder...)
	next.Pool = NewPool(a.Pool)
	next.Rosters = make(map[string][]RosterSlot, len(a.DraftOrder))
	next.Budgets = map[string]int{}
	for _, team := range a.DraftOrder {
		next.Rosters[team] = []RosterSlot{}
		if isAuction {
			next.Budgets[team] = *budget
		}
	}
	next.Auction = nil
	if isAuction {
		next.Auction = &AuctionState{NominatingTeamID: stringPtr(a.DraftOrder[0]), MinBid: a.MinBid}
	}
	next.PickNumber = 1
	next.TurnStartedAt = stringPtr(a.Timestamp)
	return next, nil
}

func hasDuplicate(ids []string) bool {
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			return true
		}
		seen[id] = true
	}
	return false
}
