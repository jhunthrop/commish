package leaguesync

import "testing"

// The per-platform Pts rule (Lane 66d, Lane 79): Sleeper, MFL and ESPN
// send each player's week points, Yahoo and FFPC each team's total alone,
// and a side whose read carried no player's points has its total alone
// whatever the platform.
func TestGivesPlayerPoints(t *testing.T) {
	scored := &Side{PlayerPoints: map[string]float64{"1": 8.7}}
	empty := &Side{PlayerPoints: map[string]float64{}}
	for _, c := range []struct {
		host string
		side *Side
		want bool
	}{
		{HostSleeper, scored, true}, {HostMFL, scored, true}, {HostESPN, scored, true},
		{HostYahoo, scored, false}, {HostFFPC, scored, false},
		{HostSleeper, empty, false}, {HostESPN, empty, false}, {HostESPN, nil, false},
	} {
		if got := GivesPlayerPoints(c.host, c.side); got != c.want {
			t.Errorf("%s %v: %v, want %v", c.host, c.side, got, c.want)
		}
	}
}
