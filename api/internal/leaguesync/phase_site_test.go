package leaguesync

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/season"
)

type fixedSite struct{ p season.SitePhase }

func (f fixedSite) Phase(context.Context) season.SitePhase { return f.p }

// The NFL state's week counts only past the site's preseason: the
// recorded state says week 6, but in the preseason the drafted league
// has no week yet and reads in season from the opener on.
func TestSleeperWeekWaitsForTheSeason(t *testing.T) {
	ref := Ref{Host: HostSleeper, LeagueID: ReplaySleeperLeague}
	host := &Sleeper{API: newSleeperRecorded(t, nil), Now: func() time.Time { return phaseNow }, Season: fixedSite{preseason}}
	snap, err := host.Read(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Week != 0 || len(snap.Matchups) != 0 {
		t.Fatalf("a preseason week counted: week %d, %d sides", snap.Week, len(snap.Matchups))
	}
	got := PhaseOf(PhaseFacts{Host: HostSleeper, Read: true, Status: snap.Status, Season: snap.Season, Week: snap.Week,
		Calendar: snap.Calendar, Site: preseason}, phaseNow)
	wantPhase(t, "preseason", got, apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and the season starts Wednesday, September 9.", 15)
	host.Season = fixedSite{season.SitePhase{Phase: season.SiteInSeason, Week: 6}}
	if snap, err = host.Read(context.Background(), ref); err != nil || snap.Week != 6 {
		t.Fatalf("in season: week %d (%v)", snap.Week, err)
	}
}

// A done FFPC draft is kept by league-team and season: the same
// league-team id in another season reads its board again.
func TestFFPCDraftDoneIsKeptBySeason(t *testing.T) {
	owner := uuid.New()
	member := &draftingMember{fakeMember: fakeMember{t: t, owner: owner, league: fixtureLeagueRead(t)}, draft: ffpc.Draft{Complete: true}}
	host := &FFPC{Member: member, Now: func() time.Time { return phaseNow }, Log: quietLog()}
	for _, y := range []int{2026, 2026, 2027} {
		if _, ok := host.draftStatus(context.Background(), owner, fixtureLTUID, y); !ok {
			t.Fatal("the board did not answer")
		}
	}
	if member.draftReads != 2 {
		t.Fatalf("%d board reads over 2026, 2026 and 2027, want 2", member.draftReads)
	}
}

// The draft answers a host keeps are bounded: a full map starts again.
func TestKeepIsBounded(t *testing.T) {
	var m map[string]bool
	for i := range maxDraftKept {
		m = keep(m, fmt.Sprint(i), true)
	}
	if m = keep(m, "0", true); len(m) != maxDraftKept {
		t.Fatalf("an existing key grew the map to %d", len(m))
	}
	if m = keep(m, "new", true); len(m) != 1 || !m["new"] {
		t.Fatalf("a full map took a new key: %d entries", len(m))
	}
}
