package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Week 6 of the rest-of-season fixture (Lane 86, the sweep's Z3): Miami
// and New England play Sunday at 1:00 pm, Tampa Bay and Detroit on Monday
// night; every club plays weeks 7 through 17 on the Sundays after.
var (
	restSunday     = time.Date(2026, 10, 18, 13, 0, 0, 0, east)
	restMonday     = time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	restRunInstant = time.Date(2026, 10, 17, 8, 0, 0, 0, east)
)

func restWeekSix(finalSunday, finalMonday bool) []boards.TeamWeek {
	games := append(game(6, "MIA", "NE", restSunday, finalSunday), game(6, "TB", "DET", restMonday, finalMonday)...)
	for week := 7; week <= 17; week++ {
		kickoff := restSunday.AddDate(0, 0, 7*(week-6))
		games = append(games, game(week, "MIA", "NE", kickoff, false)...)
		games = append(games, game(week, "TB", "DET", kickoff, false)...)
	}
	return games
}

// restRunBoard is the Saturday run's board: from week 6, a Miami back and
// a Tampa Bay back with 120 points each over the 12 games each club had
// left then.
func restRunBoard(t *testing.T) boards.Board {
	t.Helper()
	mia, tb := 120.0, 120.0
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: 6, AsOf: restRunInstant,
		Players: []boards.Player{
			{ID: "mia", Name: "A Dolphin", Position: draft.RB, Team: "MIA", Points: &mia},
			{ID: "tb", Name: "A Buccaneer", Position: draft.RB, Team: "TB", Points: &tb},
		}}
	b, err := boards.For(raw, 12, twelveTeamPPR(t))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// A club's rest of season starts at its first game still to play by the
// one game state: on Saturday every club from week 6; on Sunday evening
// Miami from week 7 while Tampa Bay's Monday game keeps week 6 on the
// board, its first week said as partly played; on Tuesday every club from
// week 7.
func TestRestAtStartsEachClubAtItsFirstGameStillToPlay(t *testing.T) {
	for _, tc := range []struct {
		name              string
		now               time.Time
		games             []boards.TeamWeek
		mia, tb, fromWeek int
		leftMIA, leftTB   int
		partial           bool
	}{
		{"saturday", restRunInstant, restWeekSix(false, false), 6, 6, 6, 12, 12, false},
		{"sunday evening", restSunday.Add(5 * time.Hour), restWeekSix(true, false), 7, 6, 6, 11, 12, true},
		{"tuesday", restMonday.Add(14 * time.Hour), restWeekSix(true, true), 7, 7, 7, 11, 11, false},
	} {
		rest := RestAt(tc.games, 6, restRunInstant, tc.now)
		if rest.From("MIA") != tc.mia || rest.From("TB") != tc.tb || rest.FromWeek != tc.fromWeek || rest.Partial != tc.partial {
			t.Fatalf("%s: MIA from %d, TB from %d, board from %d partial %v", tc.name, rest.From("MIA"), rest.From("TB"), rest.FromWeek, rest.Partial)
		}
		if rest.Left["MIA"] != tc.leftMIA || rest.Left["TB"] != tc.leftTB || rest.Run["MIA"] != 12 || rest.Run["TB"] != 12 {
			t.Fatalf("%s: left %v at the run %v", tc.name, rest.Left, rest.Run)
		}
	}
	if none := RestAt(restWeekSix(true, true), 6, restRunInstant, restSunday.AddDate(0, 0, 7*12)); none.FromWeek != 0 || none.From("MIA") != 0 {
		t.Fatalf("past week 17: from %d, MIA %d", none.FromWeek, none.From("MIA"))
	}
}

// Between the run and the next one, the live read takes the played games
// out: the run's points a game times the games still to play now, so on
// Sunday evening the Miami back's 120 over 12 games is 110 over 11, his
// figure a game unchanged, and the board revalued on it.
func TestTheLiveBoardDropsTheGamesPlayedSinceTheRun(t *testing.T) {
	b := restRunBoard(t)
	rest := RestAt(restWeekSix(true, false), b.Raw.FromWeek, b.Refreshed, restSunday.Add(5*time.Hour))
	live, err := LiveBoard(b, rest)
	if err != nil {
		t.Fatal(err)
	}
	mia, _ := live.Player("mia")
	tb, _ := live.Player("tb")
	if *mia.Points != 110 || *tb.Points != 120 {
		t.Fatalf("live points MIA %v TB %v", *mia.Points, *tb.Points)
	}
	if live.PositionRanks["tb"] != 1 || live.PositionRanks["mia"] != 2 {
		t.Fatalf("the live order %v", live.PositionRanks)
	}
	if live.FromWeek != 6 || b.FromWeek != 6 {
		t.Fatalf("from week live %d run %d", live.FromWeek, b.FromWeek)
	}
	if got := RestOfSeasonPerGame(live, mia, rest.Left); got == nil || *got != 10 {
		t.Fatalf("per game %v, want 10", got)
	}
	// Over repl. moves with the points: with no back at replacement, by his 10 points exactly.
	if live.Values["mia"] != b.Values["mia"]-10 || live.Values["tb"] != b.Values["tb"] {
		t.Fatalf("Over repl. live %v, run %v", live.Values, b.Values)
	}
	if run, _ := b.Player("mia"); *run.Points != 120 {
		t.Fatalf("the run's board changed: %v", *run.Points)
	}
	pre := restRunBoard(t)
	pre.Order = boards.OrderPreseason
	if same, _ := LiveBoard(pre, rest); same.Raw != pre.Raw {
		t.Fatal("a preseason board is not the rest of season's to rescale")
	}
}

// Review M1: through the order on Sunday evening, every row's total, Over
// repl. and A game are the re-valued board's, and the rows run in its
// Over repl. order. The fixture's week 6 is Sunday at 1:00 pm, its last
// two clubs on bye; Saturday's run counts week 6 for the clubs that play,
// so by the evening every club counts from week 7.
func TestTheOrderAgreesRowByRowAfterTheRevalue(t *testing.T) {
	f := restFixture(t)
	f.league.Board.FromWeek, f.league.Board.Refreshed = 6, restRunInstant
	sundayEvening := restSunday.Add(5 * time.Hour)
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, sundayEvening)
	if err != nil {
		t.Fatal(err)
	}
	clubs := fixtureTeams()
	onBye := map[string]bool{clubs[len(clubs)-2]: true, clubs[len(clubs)-1]: true}
	out := a.Order(orderQuery{limit: MaxOrderRows}, nil)
	if len(out.Rows) == 0 || !strings.HasPrefix(out.Basis, "Our rest-of-season order from week 7.") {
		t.Fatalf("%d rows, basis %q", len(out.Rows), out.Basis)
	}
	var last float64
	for i, row := range out.Rows {
		id := boardID(row.Line)
		run, _ := f.league.Board.Player(id)
		live, _ := a.Board.Player(id)
		atRun, left := 12.0, 11.0
		if onBye[run.Team] {
			atRun = 11
		}
		want := *run.Points * left / atRun
		if *live.Points != want || row.RestOfSeasonPoints == nil || *row.RestOfSeasonPoints != roundTenth(want) {
			t.Fatalf("%s (%s): live %v, row %v, want %v", id, run.Team, *live.Points, row.RestOfSeasonPoints, want)
		}
		if g := row.Line.RestOfSeasonPerGame; g == nil || *g != roundTenth(*run.Points/atRun) {
			t.Fatalf("%s: a game %v, want %v", id, g, roundTenth(*run.Points/atRun))
		}
		v, valued := a.Board.Values[id]
		if !valued || row.PointsOverReplacement == nil || *row.PointsOverReplacement != roundTenth(v) {
			t.Fatalf("%s: Over repl. %v, the live board's %v", id, row.PointsOverReplacement, v)
		}
		if i > 0 && v > last {
			t.Fatalf("row %d (%s) at %v sits under %v", i, id, v, last)
		}
		last = v
	}
}

// The order's line says the week it starts from, and while a game of that
// week is played that it counts the games still to play.
func TestTheOrderLineSaysWhichWeeksItCounts(t *testing.T) {
	league := OrderLeague(true, apitypes.LeagueSettings{}, apitypes.ProjectionScoringFormatPpr)
	whole := OrderScreenBasis(RestOfSeason, RestFrom{Week: 7}, league)
	if !strings.HasPrefix(whole, "Our rest-of-season order from week 7. ") {
		t.Fatalf("whole week %q", whole)
	}
	part := OrderScreenBasis(RestOfSeason, RestFrom{Week: 6, Partial: true}, league)
	if !strings.HasPrefix(part, "Our rest-of-season order from week 6's games left. ") {
		t.Fatalf("partly played week %q", part)
	}
}
