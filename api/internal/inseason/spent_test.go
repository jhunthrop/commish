package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// On a Season for the week after the clock's (WithoutSpent, Lane 95), a
// week's designation the provider listed no later than his club's last
// kickoff is spent; one listed after it stands, as does a season-long one
// whenever listed. A plain Season keeps the provider's list as it stands.
func TestWithoutSpentDropsAListingAboutAPlayedGame(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	plain := fixtureSeason(saturday)
	turned := plain.WithoutSpent()
	buf := Player{BoardID: "buf-rb", Team: "BUF", Position: draft.RB}
	ir := Player{BoardID: "mia-wr", Team: "MIA", Position: draft.WR}
	if plain.For(buf).Designation == nil {
		t.Fatal("a plain Season dropped the provider's doubtful")
	}
	if got := turned.For(buf).Designation; got != nil {
		t.Fatalf("an undated doubtful from before Buffalo's week 2 game stands: %+v", got)
	}
	if turned.For(ir).Designation == nil {
		t.Fatal("injured reserve is season-long and stands")
	}
	afterGame := time.Date(2026, 9, 23, 15, 0, 0, 0, time.UTC)
	beforeGame := time.Date(2026, 9, 19, 15, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		listed time.Time
		stands bool
	}{{afterGame, true}, {beforeGame, false}} {
		listed := tc.listed
		s := *turned
		s.designations = map[string]boards.Designation{"buf-rb": {Code: "D", AsOf: saturday, Listed: &listed}}
		if got := s.For(buf).Designation != nil; got != tc.stands {
			t.Errorf("listed %v: stands %v, want %v", tc.listed, got, tc.stands)
		}
	}
}
