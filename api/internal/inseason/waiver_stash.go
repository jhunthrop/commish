package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The adds Waivers lists and the Stash group (Lane 98, B41; Lane 118,
// B79). A free agent on a season-long list or ruled out is no pickup this
// week: with a return week inside the league's regular season he is a
// stash, sorted by his rate from that week; without one he is not listed.

// MaxStashRows is the most rows the Stash group carries.
const MaxStashRows = 10

// seasonLongLists are the designations that keep a player out for weeks.
var seasonLongLists = map[string]bool{
	boards.StatusInjuredReserve: true,
	boards.StatusPUP:            true,
	boards.StatusNFI:            true,
}

// listedAdd is whether the table lists a free agent (B41): not one on a
// season-long list or ruled out, who is no pickup this week. A week's out
// carried over from a game already played (Lane 95) stays: that listing
// predates the week the page addresses. So does one whose dating is still
// pending (Lane 118, B94): not yet known, he reads as his designation
// alone, as a questionable or doubtful one does.
func listedAdd(p person) bool {
	d := p.words.Facts.Designation
	if d == nil {
		return true
	}
	if seasonLongLists[d.Status] {
		return false
	}
	return d.Status != boards.StatusOut || d.CarriedOver || d.Pending
}

// returnHeld is a free agent the table leaves out whom the Stash group
// can hold (B79): on injured reserve or ruled out, so not listedAdd.
func returnHeld(p person) bool {
	d := p.words.Facts.Designation
	return d != nil && !listedAdd(p) && (d.Status == boards.StatusInjuredReserve || d.Status == boards.StatusOut)
}

// lastRegularWeek is the league's regular season's last week: the week
// before its first playoff week where its platform states one, else the
// order's last week.
func (a *advisor) lastRegularWeek() int {
	if first := a.Snap.Terms.PlayoffFirst; first > 1 && first-1 <= a.horizon.Last {
		return first - 1
	}
	return a.horizon.Last
}

// stashWeek is the week a free agent the Stash group holds is due back,
// false for one it does not: not held back (returnHeld), no return week,
// or one past the regular season.
func (a *advisor) stashWeek(p person) (int, bool) {
	if !returnHeld(p) {
		return 0, false
	}
	back := p.words.Facts.Designation.ReturnWeek
	if back == nil || *back > a.lastRegularWeek() {
		return 0, false
	}
	return *back, true
}

// gamesFrom is his club's games from a week through the order's last
// week still to play at the page's clock.
func (a *advisor) gamesFrom(team string, from int) int {
	return len(weeksToPlay(a.data.Games, from, a.horizon.Last, a.now)[team])
}

// perGameFrom is his rest-of-season points over his club's games from his
// return week (B79: "their rate counts from then"), nil without points.
func (a *advisor) perGameFrom(p person, back int) *float64 {
	if p.line.Player.BoardId == nil || !carriesPerGame(a.Board) {
		return nil
	}
	bp, ok := a.Board.Player(*p.line.Player.BoardId)
	if !ok || bp.Points == nil {
		return nil
	}
	games := a.gamesFrom(bp.Team, back)
	if games == 0 {
		return nil
	}
	v := roundTenth(*bp.Points / float64(games))
	return &v
}

// irSlotOpen is whether the member's team has an injured reserve slot
// open that takes him on the league's platform (B79): the league's slots
// from its settings, less the ones his roster fills; a player ruled out
// only where the platform's slot takes one.
func (a *advisor) irSlotOpen(p person) bool {
	shape := a.Snap.Shape
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok || shape.IR <= len(team.Reserve) {
		return false
	}
	return p.words.Facts.Designation.Status == boards.StatusInjuredReserve || shape.IROut
}

// stashRows is the Stash group (B79): every free agent stashWeek holds,
// the asked player aside (his row is in the table), each a waiver row
// with its stash set, by the rate from his return week, highest first,
// at most MaxStashRows. The count is the free agents on injured reserve
// or ruled out whose return no read dates.
func (a *advisor) stashRows(run waiverRun, asked string) ([]apitypes.WaiverRow, int) {
	out := []apitypes.WaiverRow{}
	undated := 0
	for _, move := range run.moves {
		add := run.pool[move.Add]
		if isAsked(add, asked) {
			continue
		}
		back, ok := a.stashWeek(add)
		if !ok {
			if returnHeld(add) && add.words.Facts.Designation.ReturnWeek == nil {
				undated++
			}
			continue
		}
		out = append(out, a.stashRow(run, add, move, back))
	}
	sort.SliceStable(out, func(i, j int) bool { return ratedAbove(out[i].Stash.PerGame, out[j].Stash.PerGame) })
	return out[:min(len(out), MaxStashRows)], undated
}

// stashRow is one stash: the waiver row of his move, no week figure (he
// plays no game this week), and with an open IR slot no drop.
func (a *advisor) stashRow(run waiverRun, add person, move Waiver, back int) apitypes.WaiverRow {
	row := waiverRow(run.w, run.week, run.mine, add, move, run.clears)
	row.WeekGain, row.Pickup, row.Starts = nil, false, false
	slot := a.irSlotOpen(add)
	if slot {
		row.Drop, row.Drops, row.Beats = nil, []apitypes.WaiverDrop{}, nil
	}
	row.Stash = &apitypes.WaiverStash{BackWeek: back, PerGame: a.perGameFrom(add, back), IrSlot: slot}
	return row
}

// ratedAbove orders two rates highest first, a missing one last.
func ratedAbove(a, b *float64) bool {
	if a == nil || b == nil {
		return a != nil && b == nil
	}
	return *a > *b
}
