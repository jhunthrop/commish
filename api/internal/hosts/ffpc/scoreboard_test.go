package ffpc

import "testing"

// The captured scoring page is week 6, an all-play week, before any game:
// the member's card reads 0.00 with 9 starters yet to play and none in
// play. The page also says it is temporarily unavailable, and the card is
// still there.
func TestScoreboard(t *testing.T) {
	s, err := ParseScoreboard(fixture(t, "ffpc-scoreboard.html"))
	if err != nil {
		t.Fatal(err)
	}
	want := Scoreboard{Week: 6, Team: "My Ball Zach Ertz", Points: 0, InPlay: 0, YetToPlay: 9}
	if s != want {
		t.Fatalf("scoreboard %+v, want %+v", s, want)
	}
	if _, err := ParseScoreboard(fixture(t, "ffpc-rosters.html")); err == nil {
		t.Fatal("the rosters page read as a scoreboard")
	}
}
