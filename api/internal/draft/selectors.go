package draft

import "math"

// AvailablePool is the undrafted pool in ranking order.
func AvailablePool(s State) []PoolEntry {
	taken := TakenOn(s)
	out := make([]PoolEntry, 0, s.Pool.Len()-taken.Count())
	for i := 0; i < s.Pool.Len(); i++ {
		if !taken.At(i) {
			out = append(out, s.Pool.At(i))
		}
	}
	return out
}

// OpenSlotCount is roster spots the team has yet to fill.
func OpenSlotCount(s State, teamID string) int {
	return TotalRosterSlots(s.Config.SlotConfig) - len(RosterFor(s, teamID))
}

// IsComplete is whether the draft has finished.
func IsComplete(s State) bool { return s.Phase == PhaseComplete }

// RemainingBudget is the team's auction dollars left.
func RemainingBudget(s State, teamID string) int { return s.Budgets[teamID] }

// MinBidFor is the lowest legal next bid.
func MinBidFor(s State) int {
	auction := AuctionOf(s)
	if auction == nil || auction.Lot == nil {
		return AuctionMinBid
	}
	return auction.Lot.HighBid + AuctionBidIncrement
}

// MaxBidFor is the team's budget less the reserve for every other open spot.
func MaxBidFor(s State, teamID string) int {
	open := OpenSlotCount(s, teamID)
	if open <= 0 {
		return 0
	}
	return max(0, RemainingBudget(s, teamID)-(open-1)*AuctionReservePerOpenSlot)
}

// MaxBidsFor is every team's current ceiling; empty for a snake draft.
func MaxBidsFor(s State) map[string]int {
	out := map[string]int{}
	if AuctionOf(s) == nil {
		return out
	}
	for _, team := range s.DraftOrder {
		out[team] = MaxBidFor(s, team)
	}
	return out
}

// HasOwedPicks is whether any team owes a pick.
func HasOwedPicks(s State) bool { return len(s.OwedPicks) > 0 }

// CatchUpTeamID is the team whose owed pick was missed earliest.
func CatchUpTeamID(s State) (string, bool) {
	best, bestPick := "", math.MaxInt
	for _, team := range s.DraftOrder {
		if owed := s.OwedPicks[team]; len(owed) > 0 && owed[0] < bestPick {
			best, bestPick = team, owed[0]
		}
	}
	return best, best != ""
}

// TeamOnClock is whose turn it is: the snake team (or the catch-up team
// past the board), or the auction team due to nominate while no lot is open.
func TeamOnClock(s State) (string, bool) {
	if s.Phase != PhaseInProgress {
		return "", false
	}
	auction := AuctionOf(s)
	if auction == nil {
		if s.PickNumber <= TotalPickCount(s) {
			return snakeTeam(s.DraftOrder, s.PickNumber), true
		}
		return CatchUpTeamID(s)
	}
	if auction.Lot != nil || auction.NominatingTeamID == nil {
		return "", false
	}
	return *auction.NominatingTeamID, true
}

// NextNominator is the next team after afterTeamID with an open spot.
func NextNominator(s State, afterTeamID string) (string, bool) {
	order := s.DraftOrder
	start := -1
	for i, team := range order {
		if team == afterTeamID {
			start = i
			break
		}
	}
	for step := 1; step <= len(order); step++ {
		team := order[(start+step+len(order))%len(order)]
		if OpenSlotCount(s, team) > 0 {
			return team, true
		}
	}
	return "", false
}

// UpcomingOnClock is the next count teams due to act, current turn first.
func UpcomingOnClock(s State, count int) []string {
	out := []string{}
	if s.Phase != PhaseInProgress {
		return out
	}
	auction := AuctionOf(s)
	if auction == nil {
		last := TotalPickCount(s)
		for pick := s.PickNumber; pick <= last && len(out) < count; pick++ {
			out = append(out, snakeTeam(s.DraftOrder, pick))
		}
		return out
	}
	team, ok := "", false
	if auction.Lot == nil {
		if auction.NominatingTeamID != nil {
			team, ok = *auction.NominatingTeamID, true
		}
	} else {
		team, ok = NextNominator(s, auction.Lot.NominatedByTeamID)
	}
	for ok && len(out) < count {
		out = append(out, team)
		team, ok = NextNominator(s, team)
	}
	return out
}
