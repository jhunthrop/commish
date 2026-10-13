package leaguesync

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxHostText bounds a host's words a page shows: a dropped rule, a
// lineup slot.
const maxHostText = 80

// cleanHostText is a host's words as a page may show them: control and
// format characters (a bidi override among them) dropped, trimmed, and
// cut at a rune boundary.
func cleanHostText(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if utf8.RuneCountInString(s) > maxHostText {
		s = string([]rune(s)[:maxHostText])
	}
	return s
}

var teamCode = regexp.MustCompile(`^[A-Z]{2,4}$`)

// cleanTeam is a host's team code, or empty when it is not one.
func cleanTeam(code string) string {
	if teamCode.MatchString(code) {
		return code
	}
	return ""
}
