package draft

// checkRosterable is "" when the team can still roster the player. The
// money rules (floor, increment, ceiling) read tunables and live in Admit.
func checkRosterable(s State, teamID, playerID string) string {
	entry, _, ok := s.Pool.Lookup(playerID)
	if !ok {
		return "That player isn't in this draft's player pool."
	}
	if a := AssignSlot(entry.Position, RosterFor(s, teamID), s.Config.SlotConfig); !a.OK {
		return a.Reason
	}
	return ""
}

func reduceNominate(s State, auction AuctionState, a Action) (State, error) {
	if auction.Lot != nil {
		return State{}, refuse("There's already a player up for bid.")
	}
	if auction.NominatingTeamID == nil || *auction.NominatingTeamID != a.TeamID {
		return State{}, refuse("It's not your turn to nominate.")
	}
	if isDrafted(s, a.PlayerID) {
		return State{}, refuse("That player has already been drafted.")
	}
	if problem := checkRosterable(s, a.TeamID, a.PlayerID); problem != "" {
		return State{}, refuse(problem)
	}
	return openLot(s, auction, a.TeamID, a.PlayerID, a.OpeningBid, a.Timestamp, false), nil
}

func openLot(s State, auction AuctionState, teamID, playerID string, amount int, timestamp string, autoNominated bool) State {
	next := s
	next.Auction = &AuctionState{
		NominatingTeamID: stringPtr(teamID),
		Lot:              &AuctionLot{PlayerID: playerID, HighBid: amount, HighBidTeamID: teamID, NominatedByTeamID: teamID, AutoNominated: autoNominated},
		MinBid:           auction.MinBid,
	}
	next.TurnStartedAt = stringPtr(timestamp)
	return next
}

func reduceBid(s State, auction AuctionState, a Action) (State, error) {
	lot := auction.Lot
	if lot == nil {
		return State{}, refuse("There's no player up for bid right now.")
	}
	if lot.HighBidTeamID == a.TeamID {
		return State{}, refuse("You can't outbid yourself.")
	}
	if problem := checkRosterable(s, a.TeamID, lot.PlayerID); problem != "" {
		return State{}, refuse(problem)
	}
	raised := *lot
	raised.HighBid, raised.HighBidTeamID = a.Amount, a.TeamID
	next := s
	next.Auction = &AuctionState{NominatingTeamID: auction.NominatingTeamID, Lot: &raised, MinBid: auction.MinBid}
	next.TurnStartedAt = stringPtr(a.Timestamp)
	return next, nil
}

// reduceAuctionExpiry awards an open lot to its high bidder and rotates
// the nomination, or nominates for a stalled team at the minimum bid.
func reduceAuctionExpiry(s State, auction AuctionState, timestamp string) (State, error) {
	lot := auction.Lot
	if lot == nil {
		if auction.NominatingTeamID == nil {
			return State{}, refuse("No eligible player is available to auto-pick.")
		}
		nominator := *auction.NominatingTeamID
		best, ok := BestNominationFor(s, nominator)
		if !ok {
			return State{}, refuse("No eligible player is available to auto-pick.")
		}
		return openLot(s, auction, nominator, best.PlayerID, auction.MinBid, timestamp, true), nil
	}
	winner := lot.HighBidTeamID
	price := lot.HighBid
	won, err := applyPick(s, pickInput{
		teamID: winner, playerID: lot.PlayerID, price: &price,
		auto: lot.AutoNominated && winner == lot.NominatedByTeamID, timestamp: timestamp,
	})
	if won, err = mustApply(won, err, "auction award: the high bidder was validated at bid time"); err != nil {
		return State{}, err
	}
	budgets := make(map[string]int, len(won.Budgets))
	for k, v := range won.Budgets {
		budgets[k] = v
	}
	budgets[winner] = RemainingBudget(won, winner) - lot.HighBid
	paid := won
	paid.Budgets = budgets
	paid.PickNumber = won.PickNumber + 1
	nominator, ok := NextNominator(paid, lot.NominatedByTeamID)
	if !ok {
		paid.Phase = PhaseComplete
		paid.Auction = &AuctionState{MinBid: auction.MinBid}
		paid.TurnStartedAt = nil
		return paid, nil
	}
	paid.Auction = &AuctionState{NominatingTeamID: stringPtr(nominator), MinBid: auction.MinBid}
	paid.TurnStartedAt = stringPtr(timestamp)
	return paid, nil
}
