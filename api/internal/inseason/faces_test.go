package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The site's slug rule (research/nightly/build/pages.py slug_of, the web's
// run-from-mock-data.ts): accents dropped, lower case, words joined by
// hyphens.
func TestSlugOf(t *testing.T) {
	cases := map[string]string{
		"Amon-Ra St. Brown": "amon-ra-st-brown", "Ja'Marr Chase": "ja-marr-chase", "José Ñúñez Jr.": "jose-nunez-jr",
		"  Kenneth Walker III ": "kenneth-walker-iii", "D.J. Moore": "d-j-moore",
	}
	for name, want := range cases {
		if got := slugOf(name); got != want {
			t.Errorf("%q: got %q, want %q", name, got, want)
		}
	}
}

// A row carries his face and his page so the screens read no board: the
// page only for a player our order ranks whose name no other player
// shares (a shared name's page takes his position and club on the run,
// which this board cannot know is the run's).
func TestPlayerLineCarriesFaceAndPage(t *testing.T) {
	f := newFixture(t)
	f.raw.Players[0].Headshot = "https://img.example/p000.png"
	f.raw.Players = append(f.raw.Players, boards.Player{ID: "twin", Name: f.raw.Players[1].Name, Position: draft.WR, Team: "KC"})
	a := newFixtureAdvisor(t, f, nil)
	out, _ := a.Lineup()
	byID := map[string]apitypes.PlayerLine{}
	for _, l := range out.Bench {
		byID[boardID(l)] = l
	}
	for _, s := range out.Slots {
		byID[boardID(s.Ours)] = s.Ours
	}
	first, twin := byID["p000"], byID["p001"]
	if first.Headshot == nil || *first.Headshot != "https://img.example/p000.png" || first.Slug == nil || *first.Slug != "player-000" {
		t.Fatalf("p000 face %v page %v", first.Headshot, first.Slug)
	}
	if twin.Slug != nil || twin.Headshot != nil {
		t.Fatalf("a shared name links %v, an empty face %v", twin.Slug, twin.Headshot)
	}
}
