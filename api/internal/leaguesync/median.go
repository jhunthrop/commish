package leaguesync

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// VsMedianBasis is the sentence under the member's points against the
// median (Lane 298).
const VsMedianBasis = "Vs median is your points less the league's median score each played week, from the platform's scores. " +
	"Weeks the platform did not score for every team are left out."

// pointsVsMedian is the member's points against each final week's median
// score, over the weeks the schedule scores for every team; nil with no
// such week.
func pointsVsMedian(snap Snapshot, roster int) *apitypes.LeagueVsMedian {
	teams := len(snap.Teams)
	if teams < 2 {
		return nil
	}
	out := apitypes.LeagueVsMedian{Weeks: []apitypes.LeagueVsMedianWeek{}, Basis: VsMedianBasis}
	for _, week := range Weeks(snap.Schedule) {
		scores := WeekScores(snap.Schedule, week)
		mine, ok := scores[roster]
		if !ok || len(scores) != teams {
			continue
		}
		points, median := tenth.Round(mine), tenth.Round(medianOf(scores))
		diff := tenth.Round(points - median)
		out.Weeks = append(out.Weeks, apitypes.LeagueVsMedianWeek{Week: week, Points: points, Median: median, Diff: diff})
		out.Total = tenth.Round(out.Total + diff)
		if diff > 0 {
			out.Above++
		}
	}
	if len(out.Weeks) == 0 {
		return nil
	}
	return &out
}

// medianOf is the middle score, the mean of the middle two for an even
// count.
func medianOf(scores map[int]float64) float64 {
	vals := make([]float64, 0, len(scores))
	for _, v := range scores {
		vals = append(vals, v)
	}
	sort.Float64s(vals)
	n := len(vals)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return vals[n/2]
	}
	return (vals[n/2-1] + vals[n/2]) / 2
}
