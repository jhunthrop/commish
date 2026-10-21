package leaguesync

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Each platform's injured reserve slots are read from the league's
// settings (Lane 118, B79), and whether a player ruled out may take one:
// ESPN's slot takes an out, Sleeper's where the league allows it, Yahoo's
// never; a league with none reads none.
func TestTheLeaguesIRSlotsAreRead(t *testing.T) {
	for _, tc := range []struct {
		name  string
		shape Shape
		ir    int
		out   bool
	}{
		{"ESPN with two", espnShape(map[int]int{0: 1, espn.SlotBench: 7, espn.SlotReserve: 2}, 12), 2, true},
		{"ESPN with none", espnShape(map[int]int{0: 1, espn.SlotBench: 7}, 12), 0, false},
		{"Sleeper allowing an out", sleeperShape(sleeper.League{TotalRosters: 12, ReserveSlots: 2, ReserveAllowOut: true}), 2, true},
		{"Sleeper not", sleeperShape(sleeper.League{TotalRosters: 12, ReserveSlots: 1}), 1, false},
		{"Sleeper with none", sleeperShape(sleeper.League{TotalRosters: 12, ReserveAllowOut: true}), 0, false},
		{"Yahoo", yahooShape(yahoo.Settings{Slots: []yahoo.Slot{{Position: "QB", Count: 1}, {Position: "IR", Count: 2}}}, 12), 2, false},
	} {
		if tc.shape.IR != tc.ir || tc.shape.IROut != tc.out {
			t.Errorf("%s: IR %d out %v, want %d %v", tc.name, tc.shape.IR, tc.shape.IROut, tc.ir, tc.out)
		}
	}
}
