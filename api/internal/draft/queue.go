package draft

import (
	"fmt"
	"math"
)

// RoundForPick is the 1-based round holding a 1-based pick.
func RoundForPick(teamCount, pickNumber int) int {
	return int(math.Ceil(float64(pickNumber) / float64(teamCount)))
}

// SnakeTeamForPick is the team on the clock at a pick: odd rounds run down
// the order, even rounds back up it.
func SnakeTeamForPick(order []string, pickNumber int) (string, error) {
	if pickNumber < 1 {
		return "", fmt.Errorf("draft: invalid pick number %d", pickNumber)
	}
	teamCount := len(order)
	if teamCount == 0 {
		return "", fmt.Errorf("draft: no draft order for pick %d", pickNumber)
	}
	round := RoundForPick(teamCount, pickNumber)
	inRound := (pickNumber - 1) % teamCount
	index := inRound
	if round%2 == 0 {
		index = teamCount - 1 - inRound
	}
	return order[index], nil
}

// snakeTeam is SnakeTeamForPick for a pick the caller has bounded.
func snakeTeam(order []string, pickNumber int) string {
	team, err := SnakeTeamForPick(order, pickNumber)
	if err != nil {
		panic(err.Error())
	}
	return team
}

// reduceSetQueue replaces one team's queue and touches nothing else, so
// editing a queue never moves anybody's clock. Team and pool membership
// are checked once the draft has an order and a pool.
func reduceSetQueue(s State, a Action) (State, error) {
	seen := make(map[string]bool, len(a.PlayerIDs))
	for _, id := range a.PlayerIDs {
		if seen[id] {
			return State{}, refuse("Each player may appear in your queue only once.")
		}
		seen[id] = true
	}
	if len(s.DraftOrder) > 0 && !contains(s.DraftOrder, a.TeamID) {
		return State{}, refuse("That team isn't in this draft.")
	}
	if s.Pool.Len() > 0 {
		for _, id := range a.PlayerIDs {
			if _, _, ok := s.Pool.Lookup(id); !ok {
				return State{}, refuse("That player isn't in this draft's player pool.")
			}
		}
	}
	queues := make(map[string][]string, len(s.Queues)+1)
	for k, v := range s.Queues {
		queues[k] = v
	}
	queues[a.TeamID] = append([]string{}, a.PlayerIDs...)
	next := s
	next.Queues = queues
	return next, nil
}

// QueueFor is the team's stored queue.
func QueueFor(s State, teamID string) []string { return s.Queues[teamID] }

// QueuedEntries is the queue projected onto the pool, in queue order; ids
// the pool lacks are dropped.
func QueuedEntries(s State, teamID string) []PoolEntry {
	queue := s.Queues[teamID]
	out := make([]PoolEntry, 0, len(queue))
	for _, id := range queue {
		if e, _, ok := s.Pool.Lookup(id); ok {
			out = append(out, e)
		}
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
