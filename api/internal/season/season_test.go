package season

import (
	"testing"
	"time"
)

// The pass is sold for the current season until its first kickoff, then
// the next, so it is never sold for a season whose drafts are over.
func TestOnSale(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		now  string
		want int
	}{
		{"2026-08-20T12:00:00Z", 2026}, // before 2026's kickoff
		{"2026-09-09T23:59:00Z", 2026}, // the eve of Thursday 2026-09-10
		{"2026-09-10T00:00:00Z", 2027}, // kickoff day: drafts are over
		{"2026-10-13T12:00:00Z", 2027},
		{"2027-02-20T12:00:00Z", 2027}, // season 2026 by Of, still sells 2027
		{"2027-08-20T12:00:00Z", 2027},
		{"2027-09-09T12:00:00Z", 2028}, // 2027's kickoff is Thursday 2027-09-09
	}
	for _, c := range cases {
		if got := OnSale(at(c.now)); got != c.want {
			t.Errorf("OnSale(%s) = %d, want %d", c.now, got, c.want)
		}
	}
	if got := End(OnSale(at("2026-10-13T12:00:00Z"))); !got.Equal(at("2028-03-01T00:00:00Z")) {
		t.Errorf("the 2027 pass ends %s, want 2028-03-01", got)
	}
}
