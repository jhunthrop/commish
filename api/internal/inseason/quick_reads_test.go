package inseason

import "testing"

// The search's quick reads (Lane 287 fix round) agree with the printed
// tenth everywhere.
func TestTheQuickReadsAgreeWithThePrintedTenth(t *testing.T) {
	for i := -3000; i <= 3000; i++ {
		v := float64(i) / 1000
		want := 0
		if r := roundTenth(v); r > 0 {
			want = 1
		} else if r < 0 {
			want = -1
		}
		if got := printedSign(v); got != want {
			t.Fatalf("printedSign(%v) = %d, want %d", v, got, want)
		}
		rest := v - GiveUp(11)
		if roughlyAcceptable(rest, 11) != Acceptable(rest, 11) {
			t.Fatalf("roughlyAcceptable(%v) disagrees", rest)
		}
	}
}
