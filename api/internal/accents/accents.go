// Package accents is the one place a name loses its accents for a
// comparison: the draft companion's and the league sync's name keys, the
// player search and the page slugs. The board keeps a name as he spells
// it ("Audric Estimé", Lane 78) while a host may send "Audric Estime";
// both compare as one. Research folds names the same way
// (research/capsules/names.py strip_accents).
package accents

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Strip is name decomposed (NFD) with its combining marks dropped, case
// and every other character kept. For comparison only, never for display.
func Strip(name string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(name) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
