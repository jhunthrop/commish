package leaguesync

import (
	"regexp"

	"github.com/jhunthrop/commish/api/internal/scoring"
)

// cleanHostText is a host's words as a page may show them: control and
// format characters (a bidi override among them) dropped, trimmed, and
// cut at 80 runes (scoring.HostText, the one rule).
func cleanHostText(s string) string { return scoring.HostText(s) }

var teamCode = regexp.MustCompile(`^[A-Z]{2,4}$`)

// cleanTeam is a host's team code, or empty when it is not one.
func cleanTeam(code string) string {
	if teamCode.MatchString(code) {
		return code
	}
	return ""
}
