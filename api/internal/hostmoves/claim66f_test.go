package hostmoves

import (
	"context"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
)

// The Waivers verb reads one rule from the claim's moves fields (Lane
// 66f), as the Lineup does from its own: whether the platform takes a
// claim at all, whether its switch is on for the account, and the line
// under the platform's waiver page verb, naming the platform, null once
// the claim is made from here.
func TestClaimMoveSaysWhy(t *testing.T) {
	r, _ := newClaimRig(t, 200, "write-claim-pending.json", nil)
	ctx := context.Background()
	r.svc.ESPNClaim = false
	got, err := r.svc.ClaimMove(ctx, me, espnhost.Host)
	if err != nil || !got.TakesWrites || got.WritesOn || got.Reason == nil || *got.Reason != claimSwitchedOffWords {
		t.Fatalf("switch off: %+v %v", got, err)
	}
	r.svc.ESPNClaim = true
	got, _ = r.svc.ClaimMove(ctx, me, espnhost.Host)
	if got.Claim != apitypes.WaiverMovesClaimAvailable || !got.WritesOn || got.Reason != nil {
		t.Fatalf("switch on: %+v", got)
	}
	r.svc.Connections = conns{nil}
	got, _ = r.svc.ClaimMove(ctx, me, espnhost.Host)
	if got.Claim != apitypes.WaiverMovesClaimUnavailable || got.Reason == nil || *got.Reason != claimConnectWords {
		t.Fatalf("not connected: %+v", got)
	}
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 2}}
	got, _ = r.svc.ClaimMove(ctx, me, espnhost.Host)
	if got.Reason == nil || *got.Reason != claimReconsentWords {
		t.Fatalf("old consent: %+v", got)
	}
	names := map[string]string{"sleeper": "Sleeper", "yahoo": "Yahoo", "mfl": "MyFantasyLeague"}
	for host, name := range names {
		got, _ := r.svc.ClaimMove(ctx, me, host)
		if got.TakesWrites || got.WritesOn || got.Reason == nil || !strings.HasPrefix(*got.Reason, name+" does not take claims from here") {
			t.Fatalf("%s: %+v", host, got)
		}
	}
	for _, s := range []string{claimSwitchedOffWords, claimConnectWords} {
		if strings.ContainsAny(s, "—–;") || strings.Contains(strings.ToLower(s), "host") {
			t.Errorf("copy rules: %q", s)
		}
	}
}
