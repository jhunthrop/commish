package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The page's two pickup orders (Lane 85 fix round 4).
const (
	weekOrder   = apitypes.WaiverAdvicePickupOrderWeek
	seasonOrder = apitypes.WaiverAdvicePickupOrderSeasonGain
)

// pastKickoff reports whether a move's add, or the drop it names, has
// kicked off or is final at the read's clock: his facts' Locked, which the
// one game state (gameStateAt) sets, the state the score bug reads.
func (r waiverRun) pastKickoff(m Waiver) bool {
	return r.pool[m.Add].cand.Locked || (m.Drop >= 0 && r.mine[m.Drop].cand.Locked)
}

// orderOf is the page's one pickup rule from every row it shows, the
// table's and the strip's: the season Gain order once any of them is past
// its kickoff, the week's otherwise.
func (r waiverRun) orderOf(shown, strip []Waiver) apitypes.WaiverAdvicePickupOrder {
	for _, moves := range [][]Waiver{shown, strip} {
		for _, m := range moves {
			if r.pastKickoff(m) {
				return seasonOrder
			}
		}
	}
	return weekOrder
}

// inSeasonOrder is the page in the season Gain order (Lane 85 fix round 4):
// the rows (built from moves, one each) by the season Gain, every week
// figure withheld, the strip the first row worth making (a Gain above zero,
// into an open roster spot or with its own drop by the one drop rule), the
// week's Proj sums held and the basis the order's.
func inSeasonOrder(out apitypes.WaiverAdvice, moves []Waiver) apitypes.WaiverAdvice {
	at := indexes(len(out.Rows))
	sort.SliceStable(at, func(i, j int) bool { return out.Rows[at[i]].Gain > out.Rows[at[j]].Gain })
	rows := make([]apitypes.WaiverRow, len(at))
	first := -1
	for k, i := range at {
		rows[k] = withheldWeek(out.Rows[i])
		if first < 0 && worthMaking(moves[i], rows[k]) {
			first = k
		}
		rows[k].Pickup = k == first
		if k == first {
			// The banner's move names the player it drops (B14).
			rows[k].Beats = dropBeats(rows[k])
		}
	}
	out.Rows, out.Pickups = rows, []apitypes.WaiverRow{}
	if first >= 0 {
		out.Pickups = []apitypes.WaiverRow{rows[first]}
	}
	out.PickupOrder, out.Basis = seasonOrder, SeasonOrderWords(out.Week)
	out.LineupProj, out.PickupsProj = nil, nil
	return out
}

// worthMaking is a row the season order's strip may name: a move to make
// (an open roster spot or a drop) that raises the season Gain.
func worthMaking(m Waiver, row apitypes.WaiverRow) bool {
	return !m.NoDrop && positive(row.Gain)
}

// withheldWeek is a row with its week figures null: its week gain, its
// drops' and whom he beats by.
func withheldWeek(row apitypes.WaiverRow) apitypes.WaiverRow {
	row.WeekGain = nil
	drops := make([]apitypes.WaiverDrop, len(row.Drops))
	for i, d := range row.Drops {
		d.WeekGain = nil
		drops[i] = d
	}
	row.Drops = drops
	if row.Beats != nil {
		beats := *row.Beats
		beats.Gain = nil
		row.Beats = &beats
	}
	return row
}
