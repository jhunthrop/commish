package entitlements_test

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// FREE_SEASON=2026 is open from the 2026 season's start until 2027-03-01
// UTC, the end a 2026 pass has, and shut either side; no setting is never
// open.
func TestFreeSeasonWindow(t *testing.T) {
	free := entitlements.FreeSeason(2026)
	end := time.Date(2027, time.March, 1, 0, 0, 0, 0, time.UTC)
	if !free.EndsAt().Equal(end) {
		t.Fatalf("EndsAt = %v, want %v", free.EndsAt(), end)
	}
	cases := []struct {
		name string
		f    entitlements.FreeSeason
		at   time.Time
		want bool
	}{
		{"in season", free, time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC), true},
		{"the season's first moment", free, time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC), true},
		{"the last moment before the end", free, end.Add(-time.Nanosecond), true},
		{"at the end", free, end, false},
		{"before the season", free, time.Date(2026, time.February, 28, 12, 0, 0, 0, time.UTC), false},
		{"no free season", entitlements.NoFreeSeason, time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC), false},
	}
	for _, c := range cases {
		if got := c.f.Open(c.at); got != c.want {
			t.Errorf("%s: Open(%v) = %v, want %v", c.name, c.at, got, c.want)
		}
	}
}
