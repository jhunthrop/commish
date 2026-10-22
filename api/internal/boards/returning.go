package boards

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
)

// Return is what the provider's return date makes of a designation
// (Lane 153), the rule api/testdata/designation-codes.json pins for both
// lanes (research/model/designations.py returning_of).
type Return int

const (
	// ReturnNone leaves the designation as it is: no date, a date already
	// passed, or a status the rule does not read (a week's designation).
	ReturnNone Return = iota
	// ReturnThisWeek is a season-long code whose return day is at or
	// before the current week's last game day: this week's designation,
	// questionable (ReturningStatus), ranked as playing.
	ReturnThisWeek
	// ReturnLater is a season-long code whose return day is after this
	// week's games: still season-long, the day carried so a row says when.
	ReturnLater
)

// ReturningStatus is the status a season-long code returning this week
// reads as: a week's designation, which moves nothing.
const ReturningStatus = StatusQuestionable

// ReturnOf reads a return day against the week. status is the code's,
// season-long by itself (SeasonLong with no note: an out for the season
// is a note's, never a code's); on is the return day, midnight Eastern
// (ReturnOnOf); weekEnd is midnight Eastern after the current week's last
// game day (the week's last kickoff plus a game, on its day), zero when no
// game is left; now is the page's clock. A day before now's Eastern day
// has passed and says nothing (the provider's injDate is never read).
func ReturnOf(status string, on *time.Time, weekEnd, now time.Time) Return {
	if on == nil || !SeasonLong(status, "") {
		return ReturnNone
	}
	east := season.Eastern()
	day := now.In(east)
	if on.Before(time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, east)) {
		return ReturnNone
	}
	if !weekEnd.IsZero() && on.Before(weekEnd) {
		return ReturnThisWeek
	}
	return ReturnLater
}
