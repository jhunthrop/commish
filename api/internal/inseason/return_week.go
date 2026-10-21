package inseason

import (
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/season"
)

// weekEnd is a week of the schedule and the end of its last game day,
// midnight Eastern after it.
type weekEnd struct {
	week int
	end  time.Time
}

// weekEndsOf is each week of the schedule with the end of its last game
// day, in week order: a week runs to the end of its last game day, as the
// board's WeekAt reads it.
func weekEndsOf(games []boards.TeamWeek) []weekEnd {
	last := map[int]time.Time{}
	for _, g := range games {
		if g.Kickoff.After(last[g.Week]) {
			last[g.Week] = g.Kickoff
		}
	}
	east := season.Eastern()
	out := make([]weekEnd, 0, len(last))
	for week, kickoff := range last {
		day := kickoff.In(east)
		out = append(out, weekEnd{week, time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, east)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].week < out[j].week })
	return out
}

// returnWeek is the week the provider's expected return falls in (Lane
// 110, B79): the first week of the schedule whose last game day is on or
// after the date, so a Tuesday return is the coming week's. Nil without a
// date, or for a date past the schedule's last week (the provider's
// placeholder for the season, February).
func (s *Season) returnWeek(on *time.Time) *int {
	if on == nil {
		return nil
	}
	for _, w := range s.weekEnds {
		if on.Before(w.end) {
			week := w.week
			return &week
		}
	}
	return nil
}

// returnAfter is the return week only when it is later than the week the
// Season addresses (the lane 110 review, MEDIUM-1): a questionable or
// doubtful date in the coming days, or a date the provider let pass, names
// the page's own week or an earlier one and says nothing, so it is
// omitted; a multi-week out and the season-long statuses keep theirs.
func (s *Season) returnAfter(on *time.Time) *int {
	week := s.returnWeek(on)
	if week == nil || *week <= s.week {
		return nil
	}
	return week
}
