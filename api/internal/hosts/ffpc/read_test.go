package ffpc

import (
	"context"
	"testing"
)

// The scoring page is read only in an all-play week, and a failed read
// of it leaves the league read whole with no score.
func TestReadLeagueTakesTheScoringPageOnlyInAnAllPlayWeek(t *testing.T) {
	cases := []struct {
		name           string
		headToHead     bool
		scoreboardDown bool
		fetches        int
		scored         bool
	}{
		{"a head-to-head week skips it", true, false, 0, false},
		{"an all-play week reads it", false, false, 1, true},
		{"a failed scoring page leaves the league", false, true, 1, false},
	}
	for _, c := range cases {
		h := newMember(t, testPass)
		h.fake.headToHead, h.fake.scoreboardDown = c.headToHead, c.scoreboardDown
		l, err := h.m.ReadLeague(context.Background(), h.acct, testLTUID, false)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if h.fake.scoreboards != c.fetches || (l.Scoreboard != nil) != c.scored {
			t.Fatalf("%s: %d scoring page reads, scored %v", c.name, h.fake.scoreboards, l.Scoreboard != nil)
		}
		if len(l.Rosters) != 12 || l.Lineup == nil || len(l.Schedule) == 0 {
			t.Fatalf("%s: the league was not read whole: %d rosters, lineup %v, %d weeks",
				c.name, len(l.Rosters), l.Lineup != nil, len(l.Schedule))
		}
	}
}
