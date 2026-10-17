package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// restBoard is a rest-of-season board from fromWeek with one projected
// back, a kicker and a back with no club, valued for a 12-team league.
func restBoard(t *testing.T, fromWeek int) boards.Board {
	t.Helper()
	pts := 110.0
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: fromWeek, Players: []boards.Player{
		{ID: "rb", Name: "A Back", Position: draft.RB, Team: "MIA", Points: &pts},
		{ID: "k", Name: "A Kicker", Position: draft.K, Team: "MIA"},
		{ID: "fa", Name: "A Free Agent", Position: draft.RB, Points: &pts},
	}}
	b, err := boards.For(raw, 12, twelveTeamPPR(t))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// restSchedule is Miami's season: a game every week but its bye in week
// 9, and a postseason week 19 the order does not cover. Buffalo's last
// game is week 6.
func restSchedule() []boards.TeamWeek {
	kickoff := time.Date(2026, 9, 13, 13, 0, 0, 0, east)
	var games []boards.TeamWeek
	for week := 1; week <= 19; week++ {
		if week != 9 {
			games = append(games, game(week, "MIA", "NE", kickoff.AddDate(0, 0, 7*(week-1)), week < 7)...)
		}
	}
	return append(games, game(6, "BUF", "NYJ", kickoff.AddDate(0, 0, 35), true)...)
}

// A club's games left are its games from the order's first week through
// the last week it covers: a bye is no game, nor a week past it.
func TestGamesLeft(t *testing.T) {
	left := GamesLeft(restSchedule(), 7)
	// Weeks 7 to 17 less the bye in week 9.
	if left["MIA"] != 10 || left["NE"] != 10 || left["BUF"] != 0 {
		t.Fatalf("games left %v", left)
	}
	if left := GamesLeft(restSchedule(), 18); left["MIA"] != 0 {
		t.Fatalf("past the last week %v", left)
	}
}

// His figure is the board's rest-of-season points over the games his
// club has left, to one decimal, and absent wherever it cannot be said.
func TestRestOfSeasonPerGame(t *testing.T) {
	b := restBoard(t, 7)
	left := GamesLeft(restSchedule(), b.FromWeek)
	rb, _ := b.Player("rb")
	if got := RestOfSeasonPerGame(b, rb, left); got == nil || *got != 11 {
		t.Fatalf("per game %v, want 11", got)
	}
	// An inexact figure rounds to a tenth: 110 over three games is 36.7.
	three := GamesLeft(restSchedule(), 15)
	if three["MIA"] != 3 {
		t.Fatalf("weeks 15 to 17: %d games", three["MIA"])
	}
	if got := RestOfSeasonPerGame(b, rb, three); got == nil || *got != 36.7 {
		t.Fatalf("per game %v, want 36.7", got)
	}
	k, _ := b.Player("k")
	fa, _ := b.Player("fa")
	if got := RestOfSeasonPerGame(b, k, left); got != nil {
		t.Fatalf("a kicker with no projection has %v", *got)
	}
	if got := RestOfSeasonPerGame(b, fa, left); got != nil {
		t.Fatalf("a player with no club has %v", *got)
	}
	if got := RestOfSeasonPerGame(b, rb, GamesLeft(restSchedule(), 18)); got != nil {
		t.Fatalf("a club with no games left has %v", *got)
	}
	unsaid := restBoard(t, 0)
	if got := RestOfSeasonPerGame(unsaid, rb, left); got != nil {
		t.Fatalf("a run that does not say its first week has %v", *got)
	}
	pre := restBoard(t, 7)
	pre.Order = boards.OrderPreseason
	if got := RestOfSeasonPerGame(pre, rb, left); got != nil {
		t.Fatalf("a preseason board has %v", *got)
	}
}

func TestPerGameBasis(t *testing.T) {
	want := "Points a game are our rest-of-season projection from week 7 over the games his club has left, byes out."
	if got := PerGameBasis(7); got != want {
		t.Fatalf("%q", got)
	}
	guard(t, PerGameBasis(7))
}

// restFixture is the fixture league on a rest-of-season order from week
// 7, its clubs playing every week through 17.
func restFixture(t *testing.T) fixture {
	t.Helper()
	f := newFixture(t)
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderRestOfSeason, 7
	f.league.Snap.Week = 7
	clubs := fixtureTeams()
	kickoff := time.Date(2026, 9, 13, 13, 0, 0, 0, east)
	for week := 7; week <= LastWeek; week++ {
		for i := 0; i+1 < len(clubs); i += 2 {
			f.data.Games = append(f.data.Games, game(week, clubs[i], clubs[i+1], kickoff.AddDate(0, 0, 7*(week-1)), false)...)
		}
	}
	return f
}

// wantPerGame is a line's figure as the board and the fixture's eleven
// games left say it.
func wantPerGame(f fixture, l apitypes.PlayerLine) *float64 {
	p, ok := f.league.Board.Player(boardID(l))
	if !ok || p.Points == nil {
		return nil
	}
	v := roundTenth(*p.Points / 11)
	return &v
}

func samePerGame(a, b *float64) bool {
	return (a == nil) == (b == nil) && (a == nil || *a == *b)
}

// Every row on the three screens carries the same figure (the lineup's
// for the player page and the API's readers, Lane 64), and the waiver and
// trade bases say what it is. Start and sit ends its rows on the week's
// projection instead (Lane 66d), so its basis says nothing of it.
func TestEveryScreenCarriesTheFigure(t *testing.T) {
	f := restFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	lineup, _ := a.Lineup()
	waivers, _ := a.Waivers("")
	trades, _ := a.Trades("")
	sentence := PerGameBasis(7)
	for _, basis := range []string{waivers.Basis, trades.Basis, trades.CheckBasis} {
		if !strings.HasSuffix(basis, " "+sentence) {
			t.Errorf("basis %q does not end on %q", basis, sentence)
		}
	}
	if strings.Contains(lineup.Basis, sentence) {
		t.Errorf("the lineup basis %q speaks of points a game", lineup.Basis)
	}
	var rows []apitypes.PlayerLine
	for _, s := range lineup.Slots {
		rows = append(rows, s.Ours)
	}
	rows = append(rows, lineup.Bench...)
	for _, r := range waivers.Rows {
		rows = append(rows, r.Add)
	}
	for _, team := range trades.Teams {
		rows = append(rows, team.Roster...)
		for _, tr := range team.Trades {
			rows = append(rows, append(tr.Give, tr.Get...)...)
		}
	}
	figures := 0
	for _, l := range rows {
		if want := wantPerGame(f, l); !samePerGame(l.RestOfSeasonPerGame, want) {
			t.Fatalf("%s: %v, want %v", boardID(l), l.RestOfSeasonPerGame, want)
		}
		if l.RestOfSeasonPerGame != nil {
			figures++
		}
	}
	if figures == 0 {
		t.Fatal("no row carries a figure")
	}
	// The builder's answer carries the sentence and its players' figures.
	team := trades.Teams[0]
	check, refused, ok := a.CheckTrade(apitypes.TradeCheckInput{Team: team.RosterId,
		Give: []string{lineup.Slots[1].Ours.Player.HostId}, Get: []string{team.Roster[1].Player.HostId}})
	if !ok || refused != nil || !strings.HasSuffix(check.Basis, " "+sentence) {
		t.Fatalf("check %v %v %q", ok, refused, check.Basis)
	}
	for _, l := range append(check.Trade.Give, check.Trade.Get...) {
		if want := wantPerGame(f, l); !samePerGame(l.RestOfSeasonPerGame, want) || want == nil {
			t.Fatalf("checked %s: %v, want %v", boardID(l), l.RestOfSeasonPerGame, want)
		}
	}
}

// Before the rest-of-season order there is no figure and no sentence.
func TestNoFigureOnThePreseasonNumber(t *testing.T) {
	f := newFixture(t)
	lineup, _ := newFixtureAdvisor(t, f, nil).Lineup()
	if strings.Contains(lineup.Basis, "Points a game") {
		t.Fatalf("%q", lineup.Basis)
	}
	for _, s := range lineup.Slots {
		if s.Ours.RestOfSeasonPerGame != nil {
			t.Fatalf("%s has %v", boardID(s.Ours), *s.Ours.RestOfSeasonPerGame)
		}
	}
}

// A player on injured reserve keeps his figure: it assumes he plays, as
// his row says (Lane 63).
func TestAnInjuredPlayerKeepsHisFigure(t *testing.T) {
	f := restFixture(t)
	before, _ := newFixtureAdvisor(t, f, nil).Lineup()
	target := before.Slots[1].Ours
	f.data.Designations = map[string]boards.Designation{boardID(target): {Code: "IR", AsOf: fixtureNow.Add(-time.Hour)}}
	after, _ := newFixtureAdvisor(t, f, nil).Lineup()
	for _, l := range after.Bench {
		if boardID(l) != boardID(target) {
			continue
		}
		if l.Facts.Designation == nil || l.RestOfSeasonPerGame == nil || !samePerGame(l.RestOfSeasonPerGame, target.RestOfSeasonPerGame) {
			t.Fatalf("%s on IR: %v %v", boardID(l), l.Facts.Designation, l.RestOfSeasonPerGame)
		}
		return
	}
	t.Fatalf("%s is not on the bench", boardID(target))
}

// A rest-of-season board whose rows carry no figure (the schedule read
// holds no game from its first week) says no sentence about one.
func TestNoSentenceWithoutAFigure(t *testing.T) {
	f := newFixture(t)
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderRestOfSeason, 7
	f.league.Snap.Week = 7
	a := newFixtureAdvisor(t, f, nil)
	lineup, _ := a.Lineup()
	waivers, _ := a.Waivers("")
	trades, _ := a.Trades("")
	team := trades.Teams[0]
	check, _, _ := a.CheckTrade(apitypes.TradeCheckInput{Team: team.RosterId,
		Give: []string{lineup.Slots[1].Ours.Player.HostId}, Get: []string{team.Roster[1].Player.HostId}})
	for _, basis := range []string{lineup.Basis, waivers.Basis, trades.Basis, trades.CheckBasis, check.Basis} {
		if strings.Contains(basis, "Points a game") {
			t.Errorf("no row carries the figure, yet %q", basis)
		}
	}
}
