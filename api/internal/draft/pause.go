package draft

import (
	"fmt"
	"math"
	"time"
	// The freeze reads a zone's offsets; the image may carry no zoneinfo.
	_ "time/tzdata"
)

// fixpointCeiling bounds deadlineAfter; a real window converges in 2 to 4.
const fixpointCeiling = 1000

const msPerMinute = 60 * msPerSecond

func zoneOffsetMinutes(instantMs int64, loc *time.Location) int64 {
	_, offset := time.UnixMilli(instantMs).In(loc).Zone()
	return int64(offset / 60)
}

type localDate struct{ year, month, day int }

func localDateAt(instantMs int64, loc *time.Location) localDate {
	t := time.UnixMilli(instantMs).In(loc)
	return localDate{t.Year(), int(t.Month()), t.Day()}
}

func addDays(d localDate, days int) localDate {
	t := time.Date(d.year, time.Month(d.month), d.day+days, 0, 0, 0, 0, time.UTC)
	return localDate{t.Year(), int(t.Month()), t.Day()}
}

func utcMs(d localDate, hour int) int64 {
	return time.Date(d.year, time.Month(d.month), d.day, hour, 0, 0, 0, time.UTC).UnixMilli()
}

// zonedHourToUtcMs is the date's local hour:00 as a UTC instant, by the
// two-pass correction pause.ts uses (a spring-forward gap lands after it).
func zonedHourToUtcMs(d localDate, hour int, loc *time.Location) int64 {
	guess := utcMs(d, hour)
	off1 := zoneOffsetMinutes(guess, loc)
	u1 := guess - off1*msPerMinute
	off2 := zoneOffsetMinutes(u1, loc)
	u2 := guess - off2*msPerMinute
	if zoneOffsetMinutes(u2, loc) == off2 {
		return u2
	}
	return u1
}

func windowBounds(d localDate, w PauseWindow, loc *time.Location) (int64, int64) {
	return zonedHourToUtcMs(d, w.StartHour, loc), zonedHourToUtcMs(d, w.EndHour, loc)
}

// pausedMillisBetween is how much of [from, to) falls inside the window.
func pausedMillisBetween(fromMs, toMs int64, w PauseWindow, loc *time.Location) int64 {
	if toMs <= fromMs {
		return 0
	}
	fromDate, toDate := localDateAt(fromMs, loc), localDateAt(toMs, loc)
	days := int(math.Round(float64(utcMs(toDate, 0)-utcMs(fromDate, 0))/float64(24*msPerHour))) + 1
	total := int64(0)
	for i := 0; i < days; i++ {
		start, end := windowBounds(addDays(fromDate, i), w, loc)
		if overlap := min(toMs, end) - max(fromMs, start); overlap > 0 {
			total += overlap
		}
	}
	return total
}

// pausedUntil is the window's end if at falls inside it.
func pausedUntil(atMs int64, w PauseWindow) (int64, bool, error) {
	loc, err := time.LoadLocation(w.Zone)
	if err != nil {
		return 0, false, fmt.Errorf("draft: pause zone %q: %w", w.Zone, err)
	}
	start, end := windowBounds(localDateAt(atMs, loc), w, loc)
	return end, atMs >= start && atMs < end, nil
}

// deadlineAfter is a clock of seconds from start, extended past every
// occurrence of the window it would run through, to a fixpoint.
func deadlineAfter(startMs int64, seconds float64, w PauseWindow) (int64, error) {
	loc, err := time.LoadLocation(w.Zone)
	if err != nil {
		return 0, fmt.Errorf("draft: pause zone %q: %w", w.Zone, err)
	}
	bare := float64(startMs) + float64(seconds*msPerSecond)
	candidate := bare
	for i := 0; i < fixpointCeiling; i++ {
		paused := pausedMillisBetween(startMs, int64(math.Trunc(candidate)), w, loc)
		next := bare + float64(paused)
		if next == candidate {
			return int64(math.Trunc(candidate)), nil
		}
		candidate = next
	}
	return 0, fmt.Errorf("draft: the deadline did not converge within %d passes; the window %+v covers nearly the whole day", fixpointCeiling, w)
}

// IsPaused is whether the room is frozen at the given instant.
func IsPaused(s State, atIso string) (bool, error) {
	w := effectivePauseWindow(s)
	if w == nil {
		return false, nil
	}
	at, err := ParseMillis(atIso)
	if err != nil {
		return false, err
	}
	_, inside, err := pausedUntil(at, *w)
	return inside, err
}

// PausedUntilFor is when picks resume, if the current turn started inside
// the freeze.
func PausedUntilFor(s State) (string, bool, error) {
	w := effectivePauseWindow(s)
	if w == nil || s.TurnStartedAt == nil {
		return "", false, nil
	}
	at, err := ParseMillis(*s.TurnStartedAt)
	if err != nil {
		return "", false, err
	}
	end, inside, err := pausedUntil(at, *w)
	if err != nil || !inside {
		return "", false, err
	}
	return FormatMillis(end), true, nil
}
