package inseason

import (
	"regexp"
	"strconv"
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// hostIDPattern is the move route's own check on a claim's add
// (hostmoves checkClaim).
var hostIDPattern = regexp.MustCompile(`^-?[0-9]{1,12}$`)

// espnFixture is the fixture league on ESPN, its unrostered players named
// by numeric board ids as the real board's are (ESPN's own ids), and two
// unrostered defenses.
func espnFixture(t *testing.T) fixture {
	t.Helper()
	f := newFixture(t)
	for i := range f.raw.Players {
		if _, held := f.league.HeldBy[f.raw.Players[i].ID]; !held {
			f.raw.Players[i].ID = strconv.Itoa(4400000 + i)
		}
	}
	f.raw.Players = append(f.raw.Players,
		boards.Player{ID: "dst-ten", Name: "Titans D/ST", Position: draft.DEF, Team: "TEN"},
		boards.Player{ID: "dst-xyz", Name: "A club ESPN does not name", Position: draft.DEF, Team: "XYZ"})
	board, err := boards.For(f.raw, fixtureSettings().Teams, mustConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	f.league.Board = board
	f.league.Snap.Ref.Host = leaguesync.HostESPN
	return f
}

// ESPN's club table and the board's club codes (the 32 the screens name,
// placeNames) are the same codes, so a defense never loses its host id to
// a club spelled two ways. A code on one side only is named.
func TestESPNClubCodesAreTheBoards(t *testing.T) {
	board := placeNames()
	espnCodes := map[string]bool{}
	for _, code := range espn.TeamCodes() {
		espnCodes[code] = true
		if _, ok := board[code]; !ok {
			t.Errorf("ESPN's club %q is not a code the board uses", code)
		}
	}
	for code := range board {
		if _, ok := espn.DefenseID(code); !ok || !espnCodes[code] {
			t.Errorf("the board's club %q has no ESPN D/ST id", code)
		}
	}
	if len(espnCodes) != len(board) {
		t.Errorf("ESPN names %d clubs, the board %d", len(espnCodes), len(board))
	}
}

func mustConfig(t *testing.T) []draft.SlotConfig {
	t.Helper()
	config, err := mock.SlotConfig(fixtureSettings())
	if err != nil {
		t.Fatal(err)
	}
	return config
}

// On an ESPN league every add carries ESPN's id, the one the claim route
// takes: the board id for a player, ESPN's D/ST id for a defense. A club
// ESPN does not name carries none, so its Add stays the host's page.
func TestESPNWaiverAddsCarryTheirHostIDs(t *testing.T) {
	f := espnFixture(t)
	out, ok := newFixtureAdvisor(t, f, nil).Waivers("", "")
	if !ok || len(out.Rows) == 0 {
		t.Fatal("no waiver rows")
	}
	for _, row := range out.Rows {
		if row.Add.Player.Position == string(draft.DEF) {
			continue
		}
		if !hostIDPattern.MatchString(row.Add.Player.HostId) {
			t.Fatalf("%s: host id %q", row.Add.Player.Name, row.Add.Player.HostId)
		}
		if row.Add.Player.HostId != *row.Add.Player.BoardId {
			t.Fatalf("%s: host id %q, board id %q", row.Add.Player.Name, row.Add.Player.HostId, *row.Add.Player.BoardId)
		}
	}
	defenses, _ := newFixtureAdvisor(t, f, nil).Waivers(draft.DEF, "")
	ids := map[string]string{}
	for _, row := range defenses.Rows {
		ids[*row.Add.Player.BoardId] = row.Add.Player.HostId
	}
	if ids["dst-ten"] != "-16010" || ids["dst-xyz"] != "" {
		t.Fatalf("defenses %v", ids)
	}
	// Another host's adds name no host id: their verb is the host's page.
	f.league.Snap.Ref.Host = leaguesync.HostSleeper
	sleeper, _ := newFixtureAdvisor(t, f, nil).Waivers("", "")
	for _, row := range sleeper.Rows {
		if row.Add.Player.HostId != "" {
			t.Fatalf("a Sleeper add with host id %q", row.Add.Player.HostId)
		}
	}
}
