package boards

import (
	"testing"
	"time"
)

// The schedule's kickoff text is Eastern: 2026's opener, "8:20p" on Sep
// 9, is 00:20 UTC on Sep 10.
func TestKickoffAt(t *testing.T) {
	date := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		text string
		want time.Time
	}{
		{"8:20p", time.Date(2026, 9, 10, 0, 20, 0, 0, time.UTC)},
		{"1:00p", time.Date(2026, 9, 9, 17, 0, 0, 0, time.UTC)},
		{"12:00p", time.Date(2026, 9, 9, 16, 0, 0, 0, time.UTC)},
		{"9:30a", time.Date(2026, 9, 9, 13, 30, 0, 0, time.UTC)},
		{"", time.Date(2026, 9, 9, 4, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		got, err := KickoffAt(date, c.text)
		if err != nil || !got.Equal(c.want) {
			t.Errorf("%q: %s, %v; want %s", c.text, got.UTC(), err, c.want)
		}
	}
	for _, bad := range []string{"8:20", "25:00p", "8:61p", "noon"} {
		if _, err := KickoffAt(date, bad); err == nil {
			t.Errorf("%q: no error", bad)
		}
	}
}
