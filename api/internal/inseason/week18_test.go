package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// rateBoard is a run board from week from of two backs: a Miami back with
// his points and his points for one more game, a Tampa Bay back with 60
// and none (a run older than the column).
func rateBoard(t *testing.T, from int, run time.Time, mia, miaGame float64) boards.Board {
	t.Helper()
	tb := 60.0
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: from, AsOf: run,
		Players: []boards.Player{
			{ID: "mia", Name: "A Dolphin", Position: draft.RB, Team: "MIA", Points: &mia, GamePoints: &miaGame},
			{ID: "tb", Name: "A Buccaneer", Position: draft.RB, Team: "TB", Points: &tb},
		}}
	b, err := boards.For(raw, 12, twelveTeamPPR(t))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// lateSeason is weeks 17 and 18: Miami plays Thursday night of week 17,
// Tampa Bay that Sunday; both play week 18 the Sunday after.
func lateSeason() ([]boards.TeamWeek, time.Time, time.Time) {
	thursday := time.Date(2026, 12, 31, 20, 15, 0, 0, east)
	sunday := time.Date(2027, 1, 3, 13, 0, 0, 0, east)
	games := append(game(17, "MIA", "NE", thursday, true), game(17, "TB", "DET", sunday, false)...)
	games = append(games, game(18, "MIA", "NE", sunday.AddDate(0, 0, 7), false)...)
	games = append(games, game(18, "TB", "DET", sunday.AddDate(0, 0, 7), false)...)
	return games, thursday, sunday
}

// Review H1, a run made after a club's last week-17 game: Friday's run
// counts Miami no game through week 17, so in a league whose title week
// is 18 his week 18 is his points for one more game, never nothing. The
// Tampa Bay back, on a run older than the column, keeps the run's points
// a game for both of his games, as before. With no league the horizon is
// the run's and Miami has nothing left.
func TestWeekEighteenAfterTheClubsLastWeekSeventeenGame(t *testing.T) {
	games, thursday, sunday := lateSeason()
	friday := thursday.Add(14 * time.Hour)
	b := rateBoard(t, 17, friday, 0, 9.5)
	before := sunday.Add(-time.Hour)
	rest := RestAt(games, b.FromWeek, b.Refreshed, before, HorizonOf(titleWeekEighteen).Reaching(b.FromWeek))
	if rest.Run["MIA"] != 0 || rest.After["MIA"] != 1 || rest.Within["TB"] != 1 || rest.After["TB"] != 1 {
		t.Fatalf("run %v within %v after %v", rest.Run, rest.Within, rest.After)
	}
	live, err := LiveBoard(b, rest)
	if err != nil {
		t.Fatal(err)
	}
	mia, _ := live.Player("mia")
	tb, _ := live.Player("tb")
	if *mia.Points != 9.5 || *tb.Points != 120 {
		t.Fatalf("live MIA %v TB %v", *mia.Points, *tb.Points)
	}
	std, err := LiveBoard(b, RestAt(games, b.FromWeek, b.Refreshed, before, StandardHorizon.Reaching(b.FromWeek)))
	if err != nil {
		t.Fatal(err)
	}
	if mia, _ := std.Player("mia"); *mia.Points != 0 {
		t.Fatalf("no league: MIA %v", *mia.Points)
	}
}

// Review H1, a read in week 18: the run ranks week 18 alone (its points
// count through its own first week), so the league's order and the read
// with no league both rank on the week 18 value, never the preseason
// order; the words name the one week and no rate sentence, as the model
// counted it.
func TestAReadInWeekEighteenRanksTheWeekEighteenValue(t *testing.T) {
	games, _, sunday := lateSeason()
	tuesday := sunday.Add(48 * time.Hour)
	b := rateBoard(t, 18, tuesday, 18.4, 18.0)
	for _, h := range []Horizon{HorizonOf(titleWeekEighteen).Reaching(18), StandardHorizon.Reaching(18)} {
		if h.Last != 18 {
			t.Fatalf("horizon %+v", h)
		}
		live, err := LiveBoard(b, RestAt(games, b.FromWeek, b.Refreshed, tuesday.Add(time.Hour), h))
		if err != nil {
			t.Fatal(err)
		}
		if mia, _ := live.Player("mia"); *mia.Points != 18.4 {
			t.Fatalf("%+v: MIA %v", h, *mia.Points)
		}
		weeks := WeeksCovered(RestOfSeason, 18, h)
		if got := weekSpan(weeks, h); got != "week 18" {
			t.Fatalf("%+v: span %q", h, got)
		}
		if words := gainWords("a lineup's", RestOfSeason, weeks, h); strings.Contains(words, "rate") {
			t.Fatalf("%+v: %q", h, words)
		}
	}
}
