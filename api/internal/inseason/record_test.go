package inseason

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

type fakeRecords struct {
	weeks []leaguerecord.Week
	err   error
	me    int
}

func (f *fakeRecords) Weeks(_ context.Context, _ leaguesync.Snapshot, me int, _ map[string]int) ([]leaguerecord.Week, error) {
	f.me = me
	return f.weeks, f.err
}

// The record route answers the league's lineup and each graded week's
// points, ours and the benchmark's, for the member's own team.
func TestLeagueRecordAnswersTheLineupAndTheGradedWeeks(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	records := &fakeRecords{weeks: []leaguerecord.Week{{Week: 7, Benchmark: leaguerecord.BenchmarkESPN, Ours: 97, Theirs: 70.4, Margin: 26.6}}}
	s.Records = records
	code, env := serve(t, s, leaguePath+"record")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%d %+v", code, env.Error)
	}
	var got apitypes.LeagueRecord
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Teams != f.league.Snap.Shape.Teams || got.Lineup != f.league.Snap.Shape.API() || records.me != f.league.Me {
		t.Errorf("lineup %+v of %d teams for team %d", got.Lineup, got.Teams, records.me)
	}
	want := apitypes.LeagueRecordWeek{Week: 7, Benchmark: apitypes.LeagueRecordWeekBenchmarkEspn, Ours: 97, Theirs: 70.4, Margin: 26.6}
	if len(got.Weeks) != 1 || got.Weeks[0] != want {
		t.Errorf("weeks %+v", got.Weeks)
	}
}

// A grading that fails, or none wired, answers the lineup with no weeks.
func TestLeagueRecordWithNoGradingAnswersNoWeeks(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	for _, records := range []Records{nil, &fakeRecords{err: errors.New("register unreadable")}} {
		s.Records = records
		code, env := serve(t, s, leaguePath+"record")
		var got apitypes.LeagueRecord
		if err := json.Unmarshal(env.Data, &got); err != nil || code != http.StatusOK || got.Weeks == nil || len(got.Weeks) != 0 {
			t.Fatalf("%d %+v %v", code, got, err)
		}
	}
}
