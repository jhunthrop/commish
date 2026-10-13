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

// snakeTeam is SnakeTeamForPick for a pick the caller has bounded to
// the board; false only for an empty order or a pick below one, which no
// started draft holds.
func snakeTeam(order []string, pickNumber int) (string, bool) {
	team, err := SnakeTeamForPick(order, pickNumber)
	return team, err == nil
}
