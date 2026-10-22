package config

import "testing"

// FREE_SEASON is a season year or nothing: unset is no free season, and a
// value that is not a year is refused at start rather than read as none.
func TestFreeSeason(t *testing.T) {
	cases := []struct {
		in      string
		want    int
		refused bool
	}{
		{"", 0, false},
		{"2026", 2026, false},
		{" 2026 ", 2026, false},
		{"26", 0, true},
		{"yes", 0, true},
		{"2026-27", 0, true},
	}
	for _, c := range cases {
		l := &loader{get: func(string) string { return c.in }}
		got := l.freeSeason()
		if got != c.want || (l.err() != nil) != c.refused {
			t.Errorf("FREE_SEASON=%q: %d, err %v; want %d, refused %v", c.in, got, l.err(), c.want, c.refused)
		}
	}
}
