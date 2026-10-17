package hostmoves

import (
	"context"
	"testing"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/mflhost"
)

// The Account room's writes state is access's own answer (Lane 66k
// rereview N5): on where the Lineup's verb is open, and otherwise the
// check that stopped it, in access's order, so the room never states a
// reason the Lineup does not act on.
func TestLineupWritesFollowsAccess(t *testing.T) {
	ctx := context.Background()
	r := newMFLRig(t)
	check := func(name, host string, want hosts.WriteState) {
		t.Helper()
		got, err := r.svc.LineupWrites(ctx, me, host)
		if err != nil || got != want {
			t.Fatalf("%s: %+v %v, want %+v", name, got, err, want)
		}
	}
	check("on and connected", mflhost.Host, hosts.WriteState{On: true})
	check("yahoo", "yahoo", hosts.WriteState{Off: hosts.WritesOffTakesNone})
	r.svc.MFLLineup = false
	check("switch off", mflhost.Host, hosts.WriteState{Off: hosts.WritesOffNotOpen})
	r.proofs.allowed[me] = true
	r.svc.Connections = conns{nil}
	check("not connected", mflhost.Host, hosts.WriteState{Off: hosts.WritesOffConnect})
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusSignedOut, ConsentVersion: 1}}
	check("signed out", mflhost.Host, hosts.WriteState{Off: hosts.WritesOffReconnect})
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 0}}
	check("no consent", mflhost.Host, hosts.WriteState{Off: hosts.WritesOffReconsent})
	r.svc.MFLOpen = false
	check("closed here", mflhost.Host, hosts.WriteState{Off: hosts.WritesOffNotOpen})
}
