package sleeper

import "testing"

// settings.reserve_slots and reserve_allow_out are read (Lane 118, B79),
// a count past any league's left out.
func TestTheLeaguesReserveSettingsAreRead(t *testing.T) {
	for _, tc := range []struct {
		body  string
		slots int
		out   bool
	}{
		{`{"league_id":"1","settings":{"reserve_slots":2,"reserve_allow_out":1}}`, 2, true},
		{`{"league_id":"1","settings":{"reserve_slots":1,"reserve_allow_out":0}}`, 1, false},
		{`{"league_id":"1","settings":{"reserve_slots":99}}`, 0, false},
		{`{"league_id":"1","settings":{}}`, 0, false},
	} {
		l, err := DecodeLeague([]byte(tc.body), "1")
		if err != nil {
			t.Fatalf("%s: %v", tc.body, err)
		}
		if l.ReserveSlots != tc.slots || l.ReserveAllowOut != tc.out {
			t.Errorf("%s: %d %v, want %d %v", tc.body, l.ReserveSlots, l.ReserveAllowOut, tc.slots, tc.out)
		}
	}
}
