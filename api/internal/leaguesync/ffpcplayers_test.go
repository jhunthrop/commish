package leaguesync

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// A later page fills what an earlier line left out, and an IR mark from
// any page stays.
func TestAddPlayerFillsAndKeepsIR(t *testing.T) {
	s := Snapshot{Players: map[string]HostPlayer{}}
	s.addPlayer(ffpc.Player{ID: "26916", Name: "James Conner"})
	s.addPlayer(ffpc.Player{ID: "26916", Name: "James Conner", Position: ffpc.RB, Team: "ARI", IR: true})
	s.addPlayer(ffpc.Player{ID: "26916", Name: "James Conner", Position: ffpc.RB, Team: "ARI"})
	got := s.Players["26916"]
	if got.Position != ffpc.RB || got.Team != "ARI" || !got.InjuredReserve {
		t.Fatalf("Conner %+v", got)
	}
}

// The captured lineup marks James Conner IR beside his name, and the view
// carries the mark; nobody else on the captured roster carries it.
func TestFFPCInjuredReserveFromTheCapture(t *testing.T) {
	snap := ffpcSnapshot(fixtureLeagueRead(t), time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC), 6)
	var marked []string
	for id, p := range snap.Players {
		if p.InjuredReserve {
			marked = append(marked, id)
		}
	}
	if len(marked) != 1 || marked[0] != "26916" {
		t.Fatalf("marked IR: %v", marked)
	}
	view := players{dir: snap.Players}.player("26916")
	if !view.InjuredReserve {
		t.Fatalf("the view dropped the mark: %+v", view)
	}
}
