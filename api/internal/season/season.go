// Package season is the one rule for which fantasy season a moment
// belongs to and when that season ends. A Draft Pass is tagged with the
// season it was bought for and ends with it, never renewing (spec
// §2.6).
//
// A season runs from March 1 of its year to March 1 of the next, in
// UTC: after the Super Bowl and the last fantasy playoff week, before
// the next year's prep begins. A pass bought on 2027-08-20 is for the
// 2027 season and works until 2028-03-01.
package season

import "time"

// rolloverMonth is the month a new season begins.
const rolloverMonth = time.March

// Of is the season t falls in.
func Of(t time.Time) int {
	u := t.UTC()
	if u.Month() < rolloverMonth {
		return u.Year() - 1
	}
	return u.Year()
}

// End is the moment season s ends.
func End(s int) time.Time {
	return time.Date(s+1, rolloverMonth, 1, 0, 0, 0, 0, time.UTC)
}

// kickoffAfterLaborDay: the season's first game is the Thursday after
// Labor Day (the first Monday of September), the NFL's convention.
const kickoffAfterLaborDay = 3

// FirstKickoff is the day of season s's first game, 00:00 UTC: the
// Thursday after Labor Day. Drafts happen before it.
func FirstKickoff(s int) time.Time {
	d := time.Date(s, time.September, 1, 0, 0, 0, 0, time.UTC)
	for d.Weekday() != time.Monday {
		d = d.AddDate(0, 0, 1)
	}
	return d.AddDate(0, 0, kickoffAfterLaborDay)
}

// OnSale is the season a pass bought at t is for: the current season
// until its first kickoff, then the next one, so a pass is never sold
// for a season whose drafts are over. On 2026-10-13 that is 2027,
// ending 2028-03-01.
func OnSale(t time.Time) int {
	s := Of(t)
	if t.UTC().Before(FirstKickoff(s)) {
		return s
	}
	return s + 1
}
