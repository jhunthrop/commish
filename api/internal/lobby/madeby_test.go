package lobby

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/mock"
)

// A stand-in's pick is marked in the report's words; a drafter's and a
// bot's are not marked at all.
func TestMadeBy(t *testing.T) {
	cases := []struct {
		by   string
		want string
		ok   bool
	}{
		{ByQueue, mock.MadeByQueue, true},
		{ByClock, mock.MadeByClock, true},
		{ByDrafter, "", false},
		{ByBot, "", false},
	}
	for _, c := range cases {
		if got, ok := madeBy(c.by); got != c.want || ok != c.ok {
			t.Errorf("madeBy(%q) = %q, %v; want %q, %v", c.by, got, ok, c.want, c.ok)
		}
	}
}
