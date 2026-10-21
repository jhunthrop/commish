package draftroom

import (
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// A free agent in the room's pool (Lane 123, B101): the board's "" club
// is "FA" in the pool's club cell, with no bye, and every other player
// keeps his club.
func TestThePoolNamesAFreeAgentFAWithNoBye(t *testing.T) {
	s := reportSettings(t)
	slots, err := mock.SlotConfig(s.League)
	if err != nil {
		t.Fatal(err)
	}
	raw := rawFor(s.Pool)
	raw.Players = slices.Clone(raw.Players)
	raw.Players[0].Team, raw.Players[0].Bye = "", 0
	b, err := boards.For(raw, 12, slots)
	if err != nil {
		t.Fatal(err)
	}
	pool := BoardView(b, nil).Players
	if !slices.ContainsFunc(pool, func(p apitypes.BoardPlayer) bool { return p.Id == raw.Players[0].ID }) {
		t.Fatal("the free agent is not in the pool")
	}
	for _, p := range pool {
		switch {
		case p.Id == raw.Players[0].ID && (p.Team != "FA" || p.Bye != nil):
			t.Fatalf("the free agent reads %q, bye %v; want FA and no bye", p.Team, p.Bye)
		case p.Id != raw.Players[0].ID && (p.Team == "FA" || p.Team == ""):
			t.Fatalf("%s reads %q", p.Id, p.Team)
		}
	}
}
