package draft

import (
	"errors"
	"fmt"
)

// Admit checks the command-time preconditions: everything that reads a
// tunable or the wire clock. It runs before Reduce on a live command and
// never on replay, so a tunable changed by a deploy cannot make a
// persisted action unreplayable. A *Refusal is the rule's answer.
func Admit(s State, a Action) error {
	switch a.Type {
	case StartDraft:
		return admitStart(s)
	case SetQueue:
		if len(a.PlayerIDs) > QueueMaxLength {
			return refuse(fmt.Sprintf("A queue can hold at most %d players.", QueueMaxLength))
		}
	case TimerExpire:
		return admitTimerExpire(s, a)
	case Nominate:
		if AuctionOf(s) == nil {
			return nil
		}
		if a.OpeningBid < AuctionMinBid {
			return refuse(fmt.Sprintf("The opening bid must be at least $%d.", AuctionMinBid))
		}
		return admitAmount(s, a.TeamID, a.OpeningBid)
	case Bid:
		auction := AuctionOf(s)
		if auction == nil || auction.Lot == nil {
			return nil
		}
		if minimum := auction.Lot.HighBid + AuctionBidIncrement; a.Amount < minimum {
			return refuse(fmt.Sprintf("Your bid must be at least $%d.", minimum))
		}
		return admitAmount(s, a.TeamID, a.Amount)
	case MakePick:
		return admitMakePick(s, a)
	}
	return nil
}

func admitStart(s State) error {
	budget := s.Config.AuctionBudget
	if s.Config.Format != Auction || budget == nil || *budget <= 0 {
		return nil
	}
	if *budget < TotalRosterSlots(s.Config.SlotConfig)*AuctionMinBid {
		return refuse(fmt.Sprintf("An auction budget must be at least $%d for every roster spot.", AuctionMinBid))
	}
	return nil
}

// admitMakePick refuses a pick stamped before its turn began: the stamps
// in a log stay monotone.
func admitMakePick(s State, a Action) error {
	if s.TurnStartedAt == nil {
		return nil
	}
	at, err := ParseMillis(a.Timestamp)
	if err != nil {
		return refuse("That pick carries no valid time.")
	}
	started, err := ParseMillis(*s.TurnStartedAt)
	if err != nil {
		return fmt.Errorf("draft: turn start: %w", err)
	}
	if at < started {
		return refuse("The picks before yours are still landing.")
	}
	return nil
}

// admitTimerExpire lets a clock be expired only once it has run out.
func admitTimerExpire(s State, a Action) error {
	deadline, running, err := CurrentDeadline(s)
	if err != nil {
		return fmt.Errorf("draft: deadline: %w", err)
	}
	if !running {
		return nil
	}
	at, err := ParseMillis(a.Timestamp)
	if err != nil {
		return refuse("That expiry carries no valid time.")
	}
	due, err := ParseMillis(deadline)
	if err != nil {
		return fmt.Errorf("draft: deadline: %w", err)
	}
	if at < due {
		return refuse("The clock hasn't run out yet.")
	}
	return nil
}

func admitAmount(s State, teamID string, amount int) error {
	if OpenSlotCount(s, teamID) <= 0 {
		return nil
	}
	if ceiling := MaxBidFor(s, teamID); amount > ceiling {
		return refuse(fmt.Sprintf("You can only bid up to $%d. You need $%d for each of your remaining roster spots.", ceiling, AuctionReservePerOpenSlot))
	}
	return nil
}

// IsRefusal reports whether err is a rule's answer rather than a defect.
func IsRefusal(err error) bool {
	var r *Refusal
	return errors.As(err, &r)
}

// Submit is the command path: Admit, then Reduce.
func Submit(s State, a Action) (State, error) {
	if err := Admit(s, a); err != nil {
		return State{}, err
	}
	return Reduce(s, a)
}

// ReplayError is a persisted action that no longer applies: corruption,
// not a drafter's mistake.
type ReplayError struct {
	Sequence int
	Err      error
}

func (e *ReplayError) Error() string {
	return fmt.Sprintf("draft action %d could not be replayed: %v", e.Sequence, e.Err)
}

func (e *ReplayError) Unwrap() error { return e.Err }

// Replay rebuilds state from the log. This, not any cache, is what makes
// a draft recoverable.
func Replay(config Config, actions []Action) (State, error) {
	s := Initial(config)
	for _, a := range actions {
		next, err := Reduce(s, a)
		if err != nil {
			return State{}, &ReplayError{Sequence: s.Sequence + 1, Err: err}
		}
		s = next
	}
	return s, nil
}
