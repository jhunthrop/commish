package leaguesync

import (
	"context"
	"errors"
	"testing"
	"time"
)

// With FFPC switched off, an FFPC league reads as off, never as a bad link.
func TestFFPCOffIsNotABadLink(t *testing.T) {
	p := &Poller{Hosts: Hosts{}, Store: nil, Now: time.Now, Log: quietLog()}
	_, err := p.Read(context.Background(), Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026})
	if !errors.Is(err, ErrHostOff) {
		t.Fatalf("an off FFPC league: %v", err)
	}
}
