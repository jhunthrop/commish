package inseason

import (
	"regexp"
	"strings"

	"github.com/jhunthrop/commish/api/internal/accents"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// notSlug is a run of characters a slug joins with one hyphen.
var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slugOf is the site's slug rule for a player's page (research's
// nightly/build/pages.py slug_of, the web's run-from-mock-data.ts):
// accents dropped, lower case, words joined by hyphens.
func slugOf(name string) string {
	return strings.Trim(notSlug.ReplaceAllString(strings.ToLower(accents.Strip(name)), "-"), "-")
}

// pages names each board player's page by his slug where the name alone
// names it: the run gives a name shared by two players a slug with his
// position and club, over its own set of players, so a shared name here
// gets no page rather than a guessed one.
type pages struct {
	shared map[string]bool
}

func newPages(raw *boards.Raw) pages {
	seen := map[string]bool{}
	shared := map[string]bool{}
	for _, p := range raw.Players {
		s := slugOf(p.Name)
		shared[s] = seen[s]
		seen[s] = true
	}
	return pages{shared: shared}
}

// of is his page's slug, nil for a player the order does not rank (the
// run has no page for him) or whose name is shared.
func (p pages) of(name string, ranked bool) *string {
	s := slugOf(name)
	if !ranked || s == "" || p.shared[s] {
		return nil
	}
	return &s
}

// faceOf is his headshot, nil without one.
func faceOf(bp boards.Player, placed bool) *string {
	if !placed || bp.Headshot == "" {
		return nil
	}
	h := bp.Headshot
	return &h
}
