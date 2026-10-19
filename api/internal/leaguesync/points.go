package leaguesync

// playerPointsHosts is the platforms that send each player's week
// points: Sleeper and MFL key every rostered player, ESPN its
// rosterForCurrentScoringPeriod (Lane 79). Yahoo and FFPC send each
// team's total alone.
var playerPointsHosts = map[string]bool{HostSleeper: true, HostMFL: true, HostESPN: true}

// GivesPlayerPoints is the per-platform Pts rule (Lane 66d, Lane 79), the
// one the box scores, the Lineup and the bases read: the platform sends
// each player's week points and the side's read carried them. Otherwise
// the side has the platform's team total alone.
func GivesPlayerPoints(host string, side *Side) bool {
	return side != nil && playerPointsHosts[host] && len(side.PlayerPoints) > 0
}
