package leaguesync

import (
	"regexp"
)

var teamCode = regexp.MustCompile(`^[A-Z]{2,4}$`)

// cleanTeam is a host's team code, or empty when it is not one.
func cleanTeam(code string) string {
	if teamCode.MatchString(code) {
		return code
	}
	return ""
}
