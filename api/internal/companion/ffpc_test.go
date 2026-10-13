package companion

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// The founder's completed FFPC draft board becomes the Sleeper-shaped
// draft the engine replay takes, and maps to settings the rooms draft.
func TestFFPCBoardAsADraft(t *testing.T) {
	page, err := os.ReadFile(filepath.Join("..", "hosts", "ffpc", "testdata", "ffpc-draft-board.html"))
	if err != nil {
		t.Fatal(err)
	}
	d, err := ffpc.ParseDraftBoard(page)
	if err != nil {
		t.Fatal(err)
	}
	snap := ffpcSnapshot("104870", d)
	if snap.Draft.Status != sleeper.StatusComplete || snap.Draft.Teams != 12 || snap.Draft.Rounds != 20 || len(snap.Picks) != 240 {
		t.Fatalf("draft %+v with %d picks", snap.Draft, len(snap.Picks))
	}
	rules := &ffpc.Rules{Lineup: ffpc.LineupCounts{QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, Flex: 2}, HasLineup: true}
	snap.Draft.Slots = slotsOf(rules, snap.Draft.Rounds)
	league := &sleeper.League{Scoring: map[string]float64{"rec": 1, "bonus_rec_te": 0.5}}
	settings, err := SettingsFor(snap.Draft, league, 10)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Teams != 12 || settings.Roster.Bench != 10 || settings.Roster.K != 1 || settings.Roster.Dst != 1 || *settings.Slot != 10 {
		t.Fatalf("settings %+v", settings)
	}
}

// A board cell's cut name is placed by the one player at the position and
// team whose name starts with it, never guessed between two.
func TestPrefixMatchForACutName(t *testing.T) {
	raw := &boards.Raw{Players: []boards.Player{
		{ID: "1", Name: "Jaxon Smith-Njigba", Position: draft.WR, Team: "SEA"},
		{ID: "2", Name: "Jaxon Smith-Njigbo", Position: draft.WR, Team: "DAL"},
		{ID: "3", Name: "Christian Watson", Position: draft.WR, Team: "GB"},
		{ID: "4", Name: "Christian Watsonn", Position: draft.WR, Team: "GB"},
	}}
	m := &NameMatcher{}
	if id, how, ok := m.Match(raw, sleeper.Pick{Name: "Jaxon Smith-Nji", Position: "WR", Team: "SEA"}); !ok || id != "1" || how != MatchPrefix {
		t.Fatalf("cut name: %q %q %v", id, how, ok)
	}
	if _, _, ok := m.Match(raw, sleeper.Pick{Name: "Christian Wats", Position: "WR", Team: "GB"}); ok {
		t.Fatal("a cut name two players share was placed")
	}
	if _, _, ok := m.Match(raw, sleeper.Pick{Name: "Jax", Position: "WR", Team: "SEA"}); ok {
		t.Fatal("a too-short cut was placed")
	}
}
