package season

import (
	"context"
	"log/slog"
	"sync"
	"time"

	// The schedule's kickoffs are Eastern times: the zone ships in the
	// binary, so a container with no zoneinfo reads them the same.
	_ "time/tzdata"
)

// Eastern is the clock the NFL keeps and the schedule's kickoffs are in.
func Eastern() *time.Location {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		// time/tzdata is embedded, so this cannot happen in a build.
		panic("season: no America/New_York zone: " + err.Error())
	}
	return loc
}

// Schedule answers a season's first kickoff, the instant its first game
// starts, false while that season's schedule is not loaded.
type Schedule interface {
	FirstKickoff(ctx context.Context, season int) (time.Time, bool, error)
}

// kickoffAfterLaborDay: the season's first game is the Thursday after
// Labor Day (the first Monday of September), the NFL's convention.
const kickoffAfterLaborDay = 3

// FallbackKickoff is the stand-in when a season's schedule is not loaded
// yet: 00:00 UTC on the Thursday after Labor Day, a little before any
// real opener, so a pass is never sold for a season already under way.
func FallbackKickoff(s int) time.Time {
	d := time.Date(s, time.September, 1, 0, 0, 0, 0, time.UTC)
	for d.Weekday() != time.Monday {
		d = d.AddDate(0, 0, 1)
	}
	return d.AddDate(0, 0, kickoffAfterLaborDay)
}

// Sale is the one rule for which season a pass bought now is for: the
// current season until its first game kicks off, then the next, so a
// pass is never sold for a season whose drafts are over. On 2026-10-13
// that is 2027, ending 2028-03-01. The kickoff is read from the schedule
// and kept; with the schedule not loaded, FallbackKickoff stands in and
// the stand-in is logged once per season.
type Sale struct {
	Schedule Schedule
	Log      *slog.Logger

	mu     sync.Mutex
	known  map[int]time.Time
	warned map[int]bool
}

// Season is the season a pass bought at t is for.
func (s *Sale) Season(ctx context.Context, t time.Time) int {
	y := Of(t)
	if t.Before(s.kickoff(ctx, y)) {
		return y
	}
	return y + 1
}

func (s *Sale) kickoff(ctx context.Context, y int) time.Time {
	s.mu.Lock()
	k, ok := s.known[y]
	s.mu.Unlock()
	if ok {
		return k
	}
	if s.Schedule != nil {
		k, found, err := s.Schedule.FirstKickoff(ctx, y)
		if err == nil && found {
			s.mu.Lock()
			if s.known == nil {
				s.known = map[int]time.Time{}
			}
			s.known[y] = k
			s.mu.Unlock()
			return k
		}
		if err != nil {
			s.warn(y, "the schedule could not be read", err)
			return FallbackKickoff(y)
		}
	}
	s.warn(y, "the schedule is not loaded", nil)
	return FallbackKickoff(y)
}

func (s *Sale) warn(y int, why string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.warned[y] || s.Log == nil {
		return
	}
	if s.warned == nil {
		s.warned = map[int]bool{}
	}
	s.warned[y] = true
	s.Log.Warn("season: first kickoff from the fallback", "season", y, "why", why, "fallback", FallbackKickoff(y), "err", err)
}
