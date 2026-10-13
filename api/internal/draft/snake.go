package draft

// settleCatchUp gives the next owed pick a fresh clock, or ends the draft
// once nothing is owed.
func settleCatchUp(s State, timestamp string) State {
	next := s
	if HasOwedPicks(s) {
		next.TurnStartedAt = stringPtr(timestamp)
		return next
	}
	next.Phase = PhaseComplete
	next.TurnStartedAt = nil
	return next
}

// advanceSnake moves to the next pick, or past the board into the
// catch-up turns while a pick is owed, or ends the draft.
func advanceSnake(s State, timestamp string) State {
	next := s
	next.PickNumber = s.PickNumber + 1
	if next.PickNumber > TotalPickCount(s) && !HasOwedPicks(s) {
		next.Phase = PhaseComplete
		next.TurnStartedAt = nil
		return next
	}
	next.TurnStartedAt = stringPtr(timestamp)
	return next
}

func reduceMakePick(s State, a Action) (State, error) {
	if s.Config.Format != Snake {
		return State{}, refuse("This is an auction draft. Nominate a player instead of picking.")
	}
	onClock, hasClock := TeamOnClock(s)
	inCatchUp := s.PickNumber > TotalPickCount(s)
	if !inCatchUp && hasClock && onClock == a.TeamID {
		applied, err := applyPick(s, pickInput{teamID: a.TeamID, playerID: a.PlayerID, timestamp: a.Timestamp})
		if err != nil {
			return State{}, err
		}
		return advanceSnake(applied, a.Timestamp), nil
	}
	if len(s.OwedPicks[a.TeamID]) == 0 {
		return State{}, refuse("It's not your turn to pick.")
	}
	// An owed pick may be redeemed any time; only the team holding the
	// catch-up clock also settles the turn.
	redeemed, err := redeemOwedPick(s, a.TeamID, a.PlayerID, false, a.Timestamp)
	if err != nil {
		return State{}, err
	}
	if inCatchUp && hasClock && onClock == a.TeamID {
		return settleCatchUp(redeemed, a.Timestamp), nil
	}
	return redeemed, nil
}

// reduceSnakeExpiry autopicks for the team on the clock, or skips a team
// the snapshotted skip policy forgives.
func reduceSnakeExpiry(s State, timestamp string) (State, error) {
	if s.PickNumber > TotalPickCount(s) {
		return reduceCatchUpExpiry(s, timestamp)
	}
	teamID := snakeTeam(s.DraftOrder, s.PickNumber)
	if skipEligible(s, teamID) {
		return advanceSnake(addOwedPick(s, teamID, s.PickNumber), timestamp), nil
	}
	best, ok := BestAvailableFor(s, teamID)
	if !ok {
		return State{}, refuse("No eligible player is available to auto-pick.")
	}
	applied, err := applyPick(s, pickInput{teamID: teamID, playerID: best.PlayerID, auto: true, timestamp: timestamp})
	if applied, err = mustApply(applied, err, "autopick chosen by BestAvailableFor must be applicable"); err != nil {
		return State{}, err
	}
	return advanceSnake(applied, timestamp), nil
}

// skipEligible is the consent ruling: no queue, a clock slow enough for
// the room to be asleep, and under the owed allowance.
func skipEligible(s State, teamID string) bool {
	policy := s.Config.SkipPolicy
	if policy == nil || len(QueueFor(s, teamID)) > 0 {
		return false
	}
	tier, ok := CurrentTier(s)
	if !ok || tier.PickSeconds < policy.AppliesAtOrAbovePickSeconds {
		return false
	}
	return len(s.OwedPicks[teamID]) < policy.MaxOwedPerTeam
}

func addOwedPick(s State, teamID string, pickNumber int) State {
	owed := make(map[string][]int, len(s.OwedPicks)+1)
	for k, v := range s.OwedPicks {
		owed[k] = v
	}
	list := make([]int, len(s.OwedPicks[teamID]), len(s.OwedPicks[teamID])+1)
	copy(list, s.OwedPicks[teamID])
	owed[teamID] = append(list, pickNumber)
	next := s
	next.OwedPicks = owed
	return next
}

// reduceCatchUpExpiry always autopicks: an owed pick already had its one
// forgiveness.
func reduceCatchUpExpiry(s State, timestamp string) (State, error) {
	teamID, ok := CatchUpTeamID(s)
	if !ok {
		return State{}, refuse("No pick is currently owed.")
	}
	best, ok := BestAvailableFor(s, teamID)
	if !ok {
		return State{}, refuse("No eligible player is available to auto-pick.")
	}
	redeemed, err := redeemOwedPick(s, teamID, best.PlayerID, true, timestamp)
	if redeemed, err = mustApply(redeemed, err, "autopick chosen by BestAvailableFor must be applicable"); err != nil {
		return State{}, err
	}
	return settleCatchUp(redeemed, timestamp), nil
}
