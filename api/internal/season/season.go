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
