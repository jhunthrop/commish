package inseason

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The adds Waivers lists and the Stash group (Lane 98, B41; Lane 118,
// B79). A free agent on a season-long list or ruled out is no pickup this
// week: with a return week inside the league's regular season he is a
// stash, sorted by his rate a game; without one he is not listed. One due
// back in the week the page addresses is listed with the rows when his
// move gains, and is a stash "back this week" when it does not.

// MaxStashRows is the most rows the Stash group carries.
const MaxStashRows = 10

// listedAdd is whether the table lists a free agent by his designation
// alone (B41): not one on a season-long list or ruled out, who is no
// pickup this week. A week's out carried over from a game already played
// (Lane 95) stays: that listing predates the week the page addresses. So
// does one whose dating is still pending (Lane 118, B94): not yet known,
// he reads as his designation alone, as a questionable or doubtful one
// does.
func listedAdd(p person) bool { return pickupFacts(p.words.Facts) }

// pickupFacts is listedAdd on a free agent's facts alone: the rule the
// trades' waiver level reads too (freeLevels, Lane 269 fix round 2).
func pickupFacts(f Facts) bool {
	d := f.Designation
	if d == nil {
		return true
	}
	if d.SeasonLong {
		return false
	}
	return d.Status != boards.StatusOut || d.CarriedOver || d.Pending
}

// listedMove is whether the table lists a free agent's move: listedAdd,
// or one held back (returnHeld) who is due back in the week the page
// addresses and whose move gains (Lane 118 fix round 1): he plays this
// week, so he is a pickup like any other.
func listedMove(p person, move Waiver) bool {
	return listedAdd(p) || (backThisWeek(p) && positive(move.Gain))
}

// returnHeld is a free agent the table leaves out by his designation whom
// the Stash group can hold (B79): on injured reserve or ruled out.
func returnHeld(p person) bool {
	d := p.words.Facts.Designation
	return d != nil && !listedAdd(p) && (d.Status == boards.StatusInjuredReserve || d.Status == boards.StatusOut)
}

// backThisWeek is a held-back free agent due back in the week his facts
// address.
func backThisWeek(p person) bool {
	if !returnHeld(p) {
		return false
	}
	back := p.words.Facts.Designation.Back
	return back != nil && *back == p.words.Facts.Week
}

// takenRegularLast is the regular season's last week where the league's
// platform states neither its playoffs' first week nor a playoff start
// (Lane 121, B99): week 14, as most leagues' schedules have it, and the
// Stash line says so ("Regular season taken as weeks 1 to 14.").
const takenRegularLast = 14

// lastRegularWeek is the league's regular season's last week (Lane 121,
// B99): the week before its first playoff week as the league's terms
// state it (Sleeper's, ESPN's and FFPC's rules page), else before the
// league's playoff start (MyFantasyLeague's week after its last regular
// week), else the last regular week a league with no playoffs states
// (MyFantasyLeague's whole season, fix round 1 LOW-3), else
// takenRegularLast, taken true.
func (a *advisor) lastRegularWeek() (last int, taken bool) {
	c := a.Snap.Calendar
	return regularSeasonLast(a.Snap.Terms.PlayoffFirst, c.PlayoffStartWeek, c.RegularSeasonLast, a.horizon.Last)
}

// regularSeasonLast is the week before the first of the stated playoff
// starts inside the season's horizon, else a stated last regular week
// inside it, else takenRegularLast, taken.
func regularSeasonLast(termsFirst, calendarFirst, statedLast, horizon int) (int, bool) {
	for _, first := range []int{termsFirst, calendarFirst} {
		if first > 1 && first-1 <= horizon {
			return first - 1, false
		}
	}
	if statedLast > 0 && statedLast <= horizon {
		return statedLast, false
	}
	return min(takenRegularLast, horizon), true
}

// regularSeasonTaken is the regular season's last week as taken, for the
// Waivers answer, nil where the league's platform states it.
func (a *advisor) regularSeasonTaken() *int {
	last, taken := a.lastRegularWeek()
	if !taken {
		return nil
	}
	return &last
}

// stashWeek is the week a free agent the Stash group holds is due back,
// false for one it does not: not held back (returnHeld), no return week,
// or one past the regular season.
func (a *advisor) stashWeek(p person) (int, bool) {
	if !returnHeld(p) {
		return 0, false
	}
	back := p.words.Facts.Designation.Back
	if last, _ := a.lastRegularWeek(); back == nil || *back > last {
		return 0, false
	}
	return *back, true
}

// unlistedAdd is a free agent neither Waivers' table nor its Stash group
// holds (Lane 128): one listedAdd leaves out whom stashWeek does not hold,
// on injured reserve with no return week among them. The order offers him
// no move.
func (a *advisor) unlistedAdd(p person) bool {
	if listedAdd(p) {
		return false
	}
	_, held := a.stashWeek(p)
	return !held
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

// stashCounts is what the Stash group's line counts: the held-back free
// agents no read dates, and those due back after the regular season.
type stashCounts struct {
	undated, late int
}

// stashRows is the Stash group (B79): every free agent stashWeek holds
// whose move the table does not list, the asked player aside (his row is
// in the table), each a waiver row with its stash set, by his rate a
// game, highest first, at most MaxStashRows.
func (a *advisor) stashRows(run waiverRun, asked string) ([]apitypes.WaiverRow, stashCounts) {
	out := []apitypes.WaiverRow{}
	var counts stashCounts
	for _, move := range run.moves {
		add := run.pool[move.Add]
		if isAsked(add, asked) || listedMove(add, move) || !returnHeld(add) {
			continue
		}
		back, ok := a.stashWeek(add)
		switch {
		case ok:
			out = append(out, a.stashRow(run, add, move, back))
		case add.words.Facts.Designation.Back == nil:
			counts.undated++
		default:
			counts.late++
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return ratedAbove(out[i].Stash.PerGame, out[j].Stash.PerGame) })
	return out[:min(len(out), MaxStashRows)], counts
}

// stashRow is one stash: the waiver row of his move with no week figure
// and no Beats (he plays no game before the week he is back), its rate
// the figure his player page shows, his rest-of-season points a game
// (Lane 118 fix round 1, HIGH-1). The drop is the gaining rows' drop
// rule's: an IR slot frees no bench spot until the platform moves him, so
// only a roster with a bench spot open (the search's no-drop move) has
// none.
func (a *advisor) stashRow(run waiverRun, add person, move Waiver, back int) apitypes.WaiverRow {
	row := waiverRow(run.w, run.week, run.mine, add, move, run.clears)
	row.WeekGain, row.Pickup, row.Starts, row.Beats = nil, false, false, nil
	row.Stash = &apitypes.WaiverStash{BackWeek: back, PerGame: add.line.RestOfSeasonPerGame, IrSlot: a.irSlotOpen(add)}
	return row
}

// ratedAbove orders two rates highest first, a missing one last.
func ratedAbove(a, b *float64) bool {
	if a == nil || b == nil {
		return a != nil && b == nil
	}
	return *a > *b
}
