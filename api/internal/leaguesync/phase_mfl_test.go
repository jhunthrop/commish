package leaguesync

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/mfl"
)

// mflDrafted is the recorded MyFantasyLeague league with draft results
// and a season status the test sets.
type mflDrafted struct {
	MFLReplay
	results    mfl.DraftResults
	resultsErr error
	completed  int
	reads      int
}

func (m *mflDrafted) DraftResults(context.Context, int, string) (mfl.DraftResults, error) {
	m.reads++
	return m.results, m.resultsErr
}

func (m *mflDrafted) SeasonStatus(ctx context.Context, season int) (mfl.Status, error) {
	st, err := m.MFLReplay.SeasonStatus(ctx, season)
	if m.completed > 0 {
		st.CompletedWeek = m.completed
	}
	return st, err
}

// MyFantasyLeague states the draft only in its draft results: every pick
// made is past the draft (not read again), some is a draft under way,
// none is before it; results with no picks, or none at all (the
// recording's, a dynasty league's), leave the draft unstated, and week 6
// under way reads as in season, said in the basis. The playoffs start
// the week after lastRegularSeasonWeek (14), and a completed week at the
// league's endWeek (17) is the season over.
func TestMFLPhase(t *testing.T) {
	ref := Ref{Host: HostMFL, LeagueID: ReplayMFLLeague, Season: ReplayMFLSeason}
	cases := []struct {
		name       string
		results    mfl.DraftResults
		resultsErr error
		completed  int
		phase      apitypes.LeaguePhase
		basis      string
		reads      int
	}{
		{"every pick made", mfl.DraftResults{Picks: 24, Made: 24}, nil, 0, apitypes.LeaguePhaseInSeason,
			"MyFantasyLeague says the draft is done and week 6 is under way.", 1},
		{"some made", mfl.DraftResults{Picks: 24, Made: 5}, nil, 0, apitypes.LeaguePhaseDraftDay, "MyFantasyLeague says the draft is under way.", 2},
		{"none made", mfl.DraftResults{Picks: 24}, nil, 0, apitypes.LeaguePhasePreDraft, "MyFantasyLeague says the league has not drafted yet.", 2},
		{"no picks", mfl.DraftResults{}, nil, 0, apitypes.LeaguePhaseInSeason,
			"MyFantasyLeague did not state the draft and week 6 is under way.", 2},
		{"not recorded", mfl.DraftResults{}, errNotRecorded, 0, apitypes.LeaguePhaseInSeason,
			"MyFantasyLeague did not state the draft and week 6 is under way.", 2},
		{"the season over", mfl.DraftResults{Picks: 24, Made: 24}, nil, 17, apitypes.LeaguePhaseOffseason, "MyFantasyLeague says the season is over.", 1},
	}
	for _, c := range cases {
		api := &mflDrafted{MFLReplay: MFLReplay{Live: offlineMFL{}}, results: c.results, resultsErr: c.resultsErr, completed: c.completed}
		now := phaseNow
		host := &MFL{API: api, Now: func() time.Time { return now }, Log: quietLog()}
		snap, err := host.Read(context.Background(), ref)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		wantPhase(t, c.name, hostPhase(snap), c.phase, c.basis, 15)
		// A second read past the hour the answer is kept for.
		now = now.Add(2 * mflDraftTTL)
		if _, err := host.Read(context.Background(), ref); err != nil {
			t.Fatal(err)
		}
		if api.reads != c.reads {
			t.Errorf("%s: %d draft results reads over two league reads, want %d", c.name, api.reads, c.reads)
		}
	}
}
