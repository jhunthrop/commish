package leaguesync

// playerPointsHosts is the platforms that send each player's week
// points: Sleeper and MFL key every rostered player, ESPN its
// rosterForCurrentScoringPeriod (Lane 79). Yahoo and FFPC send each
// team's total alone.
var playerPointsHosts = map[string]bool{HostSleeper: true, HostMFL: true, HostESPN: true}

// teamTotalHosts is the platforms whose own team total is the score
// (coordinator ruling (a), Lane 79): ESPN beside its players' points,
// Yahoo and FFPC alone. Sleeper's and MFL's score is their players'
// points added.
var teamTotalHosts = map[string]bool{HostESPN: true, HostYahoo: true, HostFFPC: true}

// GivesPlayerPoints is the per-platform Pts rule (Lane 66d, Lane 79), the
// one the box scores, the Lineup and the bases read: the platform sends
// each player's week points and the side's read carried them. Otherwise
// the side has the platform's team total alone.
func GivesPlayerPoints(host string, side *Side) bool {
	return side != nil && playerPointsHosts[host] && len(side.PlayerPoints) > 0
}

// SendsTeamTotal is whether the platform's own total is a side's score,
// the figure the score bug and the Matchup's Totals row both print; where
// it is not, both print the side's players' points added.
func SendsTeamTotal(host string) bool { return teamTotalHosts[host] }

// StarterPoints is a starter's points so far as the league's read says
// them: nil where the side gives no player's points or its read left him
// out (an ESPN starter kicked off and missing from the period roster).
func StarterPoints(host string, side *Side, id string) (float64, bool) {
	if !GivesPlayerPoints(host, side) {
		return 0, false
	}
	v, ok := side.PlayerPoints[id]
	return v, ok
}
