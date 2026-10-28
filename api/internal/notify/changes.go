package notify

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// StatusChange is how a player's status moved between two captures, the
// changes a starter's member hears about (spec §5.3, Lane 262).
type StatusChange string

// The changes. A newly questionable player is not one: the week is full
// of them, and the screens carry the word.
const (
	ChangeOut            StatusChange = "out"
	ChangeDoubtful       StatusChange = "doubtful"
	ChangeCleared        StatusChange = "cleared"
	ChangeInjuredReserve StatusChange = "injured_reserve"
	ChangeActivated      StatusChange = "activated"
)

// Change is one player's change.
type Change struct {
	PlayerID string
	Change   StatusChange
	From, To string
}

// weekStatuses are a week's designations: a player cleared of one is
// back for the week.
var weekStatuses = map[string]bool{
	boards.StatusQuestionable: true, boards.StatusDoubtful: true, boards.StatusOut: true,
}

// changeOf is the change from one status to the next ("" is not listed),
// false when the move is not one a member hears about.
func changeOf(from, to boards.Designation, listedBefore, listedNow bool) (StatusChange, bool) {
	was, is := "", ""
	if listedBefore {
		was = from.Status()
	}
	if listedNow {
		is = to.Status()
	}
	wasLong := listedBefore && from.SeasonLong()
	isLong := listedNow && to.SeasonLong()
	switch {
	case was == is:
		return "", false
	case is == boards.StatusInjuredReserve:
		return ChangeInjuredReserve, true
	case wasLong && !isLong:
		return ChangeActivated, true
	case is == boards.StatusOut && !wasLong:
		return ChangeOut, true
	case is == boards.StatusDoubtful:
		return ChangeDoubtful, true
	case is == "" && weekStatuses[was]:
		return ChangeCleared, true
	}
	return "", false
}

// Changes is every player whose status changed between the pair's two
// captures, in player id order.
func Changes(pair boards.DesignationPair) []Change {
	ids := map[string]bool{}
	for id := range pair.Newer {
		ids[id] = true
	}
	for id := range pair.Older {
		ids[id] = true
	}
	var out []Change
	for id := range ids {
		from, before := pair.Older[id]
		to, now := pair.Newer[id]
		if c, ok := changeOf(from, to, before, now); ok {
			out = append(out, Change{PlayerID: id, Change: c, From: statusOr(from, before), To: statusOr(to, now)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PlayerID < out[j].PlayerID })
	return out
}

func statusOr(d boards.Designation, listed bool) string {
	if !listed {
		return ""
	}
	return d.Status()
}
