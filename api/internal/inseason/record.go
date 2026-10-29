package inseason

import (
	"context"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Records grades a member's league week by week (Lane 93).
// *leaguerecord.Service implements it.
type Records interface {
	Weeks(ctx context.Context, snap leaguesync.Snapshot, me int, byes map[string]int) ([]leaguerecord.Week, error)
}

// leagueRecord is GET /leagues/attached/{id}/record: the league's lineup,
// which the record page counts starters in, and our picks against the
// benchmark's lineup for each graded week. A grading that fails answers
// the lineup with no weeks, logged: the page's own record stands without
// them.
func (s *Service) leagueRecord(w http.ResponseWriter, r *http.Request) {
	l, ok := s.Leagues.Follow(w, r)
	if !ok {
		return
	}
	out := apitypes.LeagueRecord{
		Host: apitypes.LeagueHost(l.Snap.Ref.Host), Teams: l.Snap.Shape.Teams, Lineup: l.Snap.Shape.API(),
		Weeks: []apitypes.LeagueRecordWeek{},
	}
	if s.Records != nil {
		weeks, err := s.Records.Weeks(r.Context(), l.Snap, l.Me, l.Board.Byes())
		if err != nil {
			s.Log.Error("inseason: league record", "league", l.Snap.Ref.Shared().Key(), "err", err)
		}
		for _, wk := range weeks {
			out.Weeks = append(out.Weeks, apitypes.LeagueRecordWeek{
				Week: wk.Week, Benchmark: apitypes.LeagueRecordWeekBenchmark(wk.Benchmark), Ours: wk.Ours, Theirs: wk.Theirs, Margin: wk.Margin,
				Ranking: rankingOf(wk.Ranking), Set: setOf(wk.Set),
			})
		}
		out.StartSit = startSitOf(weeks)
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// rankingOf is a week's weekly record in the league as the route answers
// it (Lane 114), nil where the week has none.
func rankingOf(r *leaguerecord.Ranking) *apitypes.LeagueRanking {
	if r == nil {
		return nil
	}
	score := func(s leaguerecord.Score) apitypes.LeagueRankingScore {
		return apitypes.LeagueRankingScore{Agreement: s.Agreement, PlacesOff: s.PlacesOff, Starters: s.Starters, StartersOf: s.StartersOf}
	}
	return &apitypes.LeagueRanking{Players: r.Players, Ours: score(r.Ours), Espn: score(r.ESPN)}
}

// setOf is a week's set lineup as the route answers it (Lane 292), nil
// where the week has none.
func setOf(s *leaguerecord.SetLineup) *apitypes.LeagueRecordSet {
	if s == nil {
		return nil
	}
	return &apitypes.LeagueRecordSet{Points: s.Points, Matched: s.Matched}
}
