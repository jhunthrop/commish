package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// titleWeekEighteen is the sense-check league's terms (Lane 96, B25): six
// teams in the playoffs, weeks 15 to 18 on ESPN, the final over weeks 17
// and 18.
var titleWeekEighteen = leaguesync.Terms{PlayoffTeams: 6, PlayoffFirst: 15, PlayoffLast: 18, FinalWeeks: 2}

// A league's horizon is its platform's last playoff week; a league that
// states none, or a week past the season, keeps the run's.
func TestHorizonOf(t *testing.T) {
	for _, tc := range []struct {
		name  string
		terms leaguesync.Terms
		want  Horizon
	}{
		{"title week 18, two-week final", titleWeekEighteen, Horizon{Last: 18, FinalWeeks: 2}},
		{"title week 17", leaguesync.Terms{PlayoffFirst: 15, PlayoffLast: 17, FinalWeeks: 1}, Horizon{Last: 17, FinalWeeks: 1}},
		{"title week 16", leaguesync.Terms{PlayoffFirst: 14, PlayoffLast: 16}, Horizon{Last: 16}},
		{"no playoffs stated", leaguesync.Terms{}, StandardHorizon},
		{"past the season", leaguesync.Terms{PlayoffFirst: 17, PlayoffLast: 19}, StandardHorizon},
	} {
		if got := HorizonOf(tc.terms); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// The span's words name the league's last week and a two-week final once
// it sits inside the span.
func TestTheSpanNamesTheTitleWeeks(t *testing.T) {
	two := Horizon{Last: 18, FinalWeeks: 2}
	for _, tc := range []struct {
		weeks int
		h     Horizon
		want  string
	}{
		{11, StandardHorizon, "weeks 7 to 17"},
		{12, two, "weeks 7 to 18, the championship over weeks 17 and 18"},
		{12, Horizon{Last: 18, FinalWeeks: 1}, "weeks 7 to 18"},
		{1, two, "week 18"},
		{2, two, "weeks 17 to 18, the championship over weeks 17 and 18"},
	} {
		if got := weekSpan(tc.weeks, tc.h); got != tc.want {
			t.Errorf("%d weeks %+v: %q, want %q", tc.weeks, tc.h, got, tc.want)
		}
	}
}

// horizonFixture is the rest-of-season fixture with every club playing in
// week 18 too, its league's playoffs through week 18 as its platform
// states them, or none stated.
func horizonFixture(t *testing.T, terms leaguesync.Terms) fixture {
	t.Helper()
	f := restFixture(t)
	clubs := fixtureTeams()
	kickoff := time.Date(2026, 9, 13, 13, 0, 0, 0, east).AddDate(0, 0, 7*17)
	for i := 0; i+1 < len(clubs); i += 2 {
		f.data.Games = append(f.data.Games, game(18, clubs[i], clubs[i+1], kickoff, false)...)
	}
	f.league.Snap.Terms = terms
	return f
}

// Through the engine (Lane 96, B25): in a league whose title week is 18,
// every row's rest of season is the run's points a game over its eleven
// games through week 17 times the twelve through week 18, the order and
// the trades say weeks 7 to 18 and the two-week final, and its Gain
// averages over twelve weeks. A league that states no playoffs keeps the
// run's eleven games and week 17.
func TestTheLeagueOrderValuesThroughItsTitleWeek(t *testing.T) {
	run := horizonFixture(t, leaguesync.Terms{})
	a := newFixtureAdvisor(t, run, nil)
	title := newFixtureAdvisor(t, horizonFixture(t, titleWeekEighteen), nil)
	if a.weeks != 11 || title.weeks != 12 {
		t.Fatalf("weeks covered: %d with none stated, %d through week 18", a.weeks, title.weeks)
	}
	for _, p := range run.league.Board.Raw.Players {
		if p.Points == nil {
			continue
		}
		std, _ := a.Board.Player(p.ID)
		long, _ := title.Board.Player(p.ID)
		if *std.Points != *p.Points || *long.Points != *p.Points*12/11 {
			t.Fatalf("%s: run %v, no playoffs %v, through week 18 %v", p.ID, *p.Points, *std.Points, *long.Points)
		}
	}
	order := title.Order(orderQuery{limit: DefaultOrderRows}, nil)
	if !strings.Contains(order.Basis, "through week 18, the championship over weeks 17 and 18, byes out") {
		t.Fatalf("order basis %q", order.Basis)
	}
	if got := a.Order(orderQuery{limit: DefaultOrderRows}, nil).Basis; !strings.Contains(got, "through week 17, byes out") {
		t.Fatalf("no playoffs stated: %q", got)
	}
	trades, ok := title.Trades("")
	if !ok {
		t.Fatal("no trades answer")
	}
	if !strings.HasSuffix(trades.Basis, "to fill a spot. Week 18 counts at each player's rate a game. Our model runs through week 17.") {
		t.Fatalf("trades basis %q", trades.Basis)
	}
	if trades.GainBasis == nil || !strings.HasSuffix(*trades.GainBasis, "weeks 7 to 18, the championship over weeks 17 and 18") {
		t.Fatalf("trades gain basis %v", trades.GainBasis)
	}
}
