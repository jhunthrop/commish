package inseason

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// fakeLandings answers a landed read with the leagues given.
type fakeLandings struct{ landed []Landed }

func (f fakeLandings) Landed(context.Context, leaguesync.Ref) ([]Landed, error) { return f.landed, nil }

// A league read that lands warms the trade search for the account
// following it, so the kept search is there before any request, and the
// /trades request that follows reads it (coordinator's ruling, Lane 66u).
func TestALandedReadWarmsTheTradeSearch(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	account := uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	s.Landings = fakeLandings{landed: []Landed{{Account: account, League: f.league}}}
	a, err := s.leagueAdvisor(context.Background(), f.league, account)
	if err != nil {
		t.Fatal(err)
	}
	key := readKey(a, account.String())
	if _, ok := s.finds.lookup(key); ok {
		t.Fatal("a search is kept before any read landed")
	}
	s.Warm(context.Background(), f.league.Snap.Ref)
	kept, ok := s.finds.lookup(key)
	if !ok || len(kept) == 0 {
		t.Fatal("the landed read kept no trade search")
	}
	// The request reads the warm search: nothing new is kept for its read.
	if code, _ := serve(t, s, leaguePath+"trades"); code != http.StatusOK {
		t.Fatalf("trades: %d", code)
	}
	if n := len(s.finds.read); n != 1 {
		t.Fatalf("the request searched again: %d reads kept", n)
	}
}

// A league the screens refuse (no saved scoring) is left to its route.
func TestAWarmLeavesARefusedLeague(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	refused := f.league
	refused.Saved = nil
	s.Landings = fakeLandings{landed: []Landed{{Account: uuid.New(), League: refused}}}
	s.Warm(context.Background(), refused.Snap.Ref)
	if n := len(s.finds.read); n != 0 {
		t.Fatalf("a refused league was searched: %d", n)
	}
}
