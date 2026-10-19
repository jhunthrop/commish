package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// pastKickoff reports whether a line's game has kicked off or is final by
// the one game state (gameStateAt, carried on his facts).
func pastKickoff(line *apitypes.PlayerLine) bool {
	if line == nil || line.Facts.Bye || line.Facts.GameState == nil {
		return false
	}
	return *line.Facts.GameState != apitypes.GameStateUpcoming
}

// inSeasonOrder is the one pickup rule once a week figure no longer counts
// (Lane 85 fix round 3, M-E): when any pickup's add or drop has kicked off
// at the read's clock, the page orders its adds by the season Gain, the
// strip names the first of that order worth making with its own drop (the
// one drop rule), every week gain is withheld (null) and the basis says
// the order.
func inSeasonOrder(out *apitypes.WaiverAdvice) {
	locked := false
	for i := range out.Pickups {
		if pastKickoff(&out.Pickups[i].Add) || pastKickoff(out.Pickups[i].Drop) {
			locked = true
		}
	}
	if !locked {
		return
	}
	sort.SliceStable(out.Rows, func(i, j int) bool { return out.Rows[i].Gain > out.Rows[j].Gain })
	for i := range out.Rows {
		withholdWeek(&out.Rows[i])
	}
	out.Pickups = []apitypes.WaiverRow{}
	first := -1
	for i, row := range out.Rows {
		if first < 0 && row.Drop != nil && roundTenth(row.Gain) > 0 {
			first = i
		}
		out.Rows[i].Pickup = i == first
	}
	if first >= 0 {
		out.Pickups = append(out.Pickups, out.Rows[first])
	}
	out.LineupProj, out.PickupsProj = nil, nil
	out.Basis = SeasonOrderWords(out.Week)
}

// withholdWeek nulls a row's week figures: its week gain, its drops' and
// whom he beats by.
func withholdWeek(row *apitypes.WaiverRow) {
	row.WeekGain = nil
	for i := range row.Drops {
		row.Drops[i].WeekGain = nil
	}
	if row.Beats != nil {
		beats := *row.Beats
		beats.Gain = nil
		row.Beats = &beats
	}
}
