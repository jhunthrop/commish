package names

import (
	"errors"
	"testing"
)

// The names filter is a boundary: whatever it lets through is shown to
// strangers in a lobby.
func TestCheck(t *testing.T) {
	f := Default()
	cases := []struct {
		name string
		want error
	}{
		{"jh", ErrLength},
		{"abcdefghijklmnopqrstu", ErrLength},
		{"has space", ErrChars},
		{"émile", ErrChars},
		{"9lives", ErrDigit},
		{"admin", ErrBlocked},
		{"Commish", ErrBlocked},
		{"sh1t_happens", ErrBlocked},
		{"Big_F_U_C_K", ErrBlocked},
		{"bass_fisher", nil},
		{"_underdog", nil},
		{"Justin_H", nil},
		{"rb_dead_2027", nil},
		{"abc", nil},
		{"abcdefghijklmnopqrst", nil},
	}
	for _, c := range cases {
		if got := f.Check(c.name); !errors.Is(got, c.want) {
			t.Errorf("Check(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}
