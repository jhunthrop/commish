package accents

import (
	"testing"

	"golang.org/x/text/unicode/norm"
)

// A name drops its accents, precomposed or decomposed, and keeps its case
// and every other letter (Lane 78: the board spells him "Audric Estimé",
// the hosts send "Audric Estime").
func TestStrip(t *testing.T) {
	cases := map[string]string{
		"Audric Estimé":                  "Audric Estime",
		norm.NFD.String("Audric Estimé"): "Audric Estime",
		"Audric Estime":                  "Audric Estime",
		"Élan Ñúñez":                     "Elan Nunez",
		"D.J. Moore Jr.":                 "D.J. Moore Jr.",
	}
	for in, want := range cases {
		if got := Strip(in); got != want {
			t.Errorf("Strip(%q) = %q, want %q", in, got, want)
		}
	}
}
