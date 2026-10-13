package leaguesync

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A host's words reach a page with control and format characters gone,
// as valid text cut at a rune, and a team code is a team code or nothing.
func TestHostTextIsCleaned(t *testing.T) {
	cases := map[string]string{
		"FG 31-99 *.1 (PK)":     "FG 31-99 *.1 (PK)",
		"IDP‮_FLEX":        "IDP_FLEX",
		"  st\x00_td 6 ":        "st_td 6",
		"bad\xffbyte":           "badbyte",
		strings.Repeat("é", 90): strings.Repeat("é", maxHostText),
	}
	for in, want := range cases {
		got := cleanHostText(in)
		if got != want || !utf8.ValidString(got) {
			t.Errorf("cleanHostText(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"KC": "KC", "JAC": "JAC", "kc": "", "K‮C": "", "TOOLONG": ""} {
		if got := cleanTeam(in); got != want {
			t.Errorf("cleanTeam(%q) = %q, want %q", in, got, want)
		}
	}
}
