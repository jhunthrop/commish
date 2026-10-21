package inseason

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The clocks of B23 (Lane 111): Sunday morning before week 6's games,
// Monday night with Sunday's finals in and our stats not, and Wednesday
// once our week 6 stats have landed.
var wednesdayEvening = time.Date(2026, 10, 21, 20, 0, 0, 0, east)

// The fixture's figures: the member's quarterback (p000, ARI) ran for 100
// yards in each of weeks 1 to 5, 10 points a game in PPR; the platform
// scores his week 6 at 30.4; his backup (p001) sat, which the platform
// scores 0. Wednesday our week 6 line lands at 280 yards, 28 points.
const (
	platformQB     = "p000"
	platformQBHost = "h000"
	satOutHost     = "h001"
	platformPoints = 30.4
)

// platformFixture is the turn fixture at the clock with the member's and
// the opponent's sides carrying the platform's points for week 6, and our
// stat lines through week 5, week 6's too from Wednesday.
func platformFixture(t *testing.T, now time.Time) (*Service, fixture) {
	t.Helper()
	s, f := turnService(t, now, false)
	data := s.Facts.(weekFacts).data
	for week := 1; week <= 5; week++ {
		data.Lines = append(data.Lines, rushingLine(week, 100))
	}
	if !now.Before(wednesdayEvening) {
		data.Lines = append(data.Lines, rushingLine(6, 280))
	}
	one, _ := f.league.Snap.TeamByRoster(1)
	two, _ := f.league.Snap.TeamByRoster(2)
	f.league.Snap.Matchups = []leaguesync.Side{
		{RosterID: 1, Game: 1, Starters: one.Starters, PlayerPoints: map[string]float64{platformQBHost: platformPoints, satOutHost: 0}},
		{RosterID: 2, Game: 1, Starters: two.Starters, PlayerPoints: map[string]float64{}},
	}
	s.Leagues = fakeLeagues{f.league}
	s.Facts = weekFacts{data: data, byWeek: s.Facts.(weekFacts).byWeek}
	return s, f
}

func rushingLine(week int, yards float64) boards.StatLine {
	return boards.StatLine{PlayerID: platformQB, Position: "QB", Week: week, Team: "ARI", Metrics: map[string]float64{"rushing_yards": yards}}
}

// lineupLine is the board player's line on the Lineup, a starter or the bench.
func lineupLine(t *testing.T, l apitypes.LineupAdvice, boardID string) apitypes.PlayerLine {
	t.Helper()
	for _, s := range l.Slots {
		if s.Ours.Player.BoardId != nil && *s.Ours.Player.BoardId == boardID {
			return s.Ours
		}
	}
	for _, b := range l.Bench {
		if b.Player.BoardId != nil && *b.Player.BoardId == boardID {
			return b
		}
	}
	t.Fatalf("%s is not on the lineup", boardID)
	return apitypes.PlayerLine{}
}

// orderLine is the board player's line on the league's Players view.
func orderLine(t *testing.T, o apitypes.OrderAdvice, boardID string) apitypes.PlayerLine {
	t.Helper()
	for _, r := range o.Rows {
		if r.Line.Player.BoardId != nil && *r.Line.Player.BoardId == boardID {
			return r.Line
		}
	}
	t.Fatalf("%s is not in the order", boardID)
	return apitypes.PlayerLine{}
}

type seasonFigures struct {
	last, avg float64
	games     int
	week      int
	source    apitypes.GamePointsSource
}

func figuresOf(t *testing.T, line apitypes.PlayerLine) seasonFigures {
	t.Helper()
	if line.LastPoints == nil || line.SeasonAvg == nil || line.GamesPlayed == nil || len(line.Facts.LastGames) == 0 || line.Facts.LastGames[0].Source == nil {
		t.Fatalf("%s: last %v avg %v games %v %v", line.Player.Name, line.LastPoints, line.SeasonAvg, line.GamesPlayed, line.Facts.LastGames)
	}
	newest := line.Facts.LastGames[0]
	return seasonFigures{last: *line.LastPoints, avg: *line.SeasonAvg, games: *line.GamesPlayed, week: newest.Week, source: *newest.Source}
}

// Last, Avg and GP catch up to the weekend from the platform's points once a
// game is final (B23), on the Lineup, the Matchup, the league's Players view
// and the Waivers and Trades screens turned to week 7; our stats replace
// them the moment they land. Before the game they are our stats alone.
func TestLastAndAvgCountTheWeekendFromThePlatform(t *testing.T) {
	stats, platform := apitypes.GamePointsSourceStats, apitypes.GamePointsSourcePlatform
	for _, tc := range []struct {
		name string
		now  time.Time
		want seasonFigures
	}{
		{"Sunday morning", sundayMorning, seasonFigures{last: 10, avg: 10, games: 5, week: 5, source: stats}},
		{"Monday night", mondayNight, seasonFigures{last: 30.4, avg: 13.4, games: 6, week: 6, source: platform}},
		{"Wednesday, our stats in", wednesdayEvening, seasonFigures{last: 28, avg: 13, games: 6, week: 6, source: stats}},
	} {
		s, _ := platformFixture(t, tc.now)
		lineup := decode[apitypes.LineupAdvice](t, s, "lineup")
		if got := figuresOf(t, lineupLine(t, lineup, platformQB)); got != tc.want {
			t.Errorf("%s lineup: %+v, want %+v", tc.name, got, tc.want)
		}
		box := decode[apitypes.MatchupBox](t, s, "matchup")
		if got := figuresOf(t, box.Sides[0].Starters[0].Line); got != tc.want {
			t.Errorf("%s matchup: %+v, want %+v", tc.name, got, tc.want)
		}
		order := decode[apitypes.OrderAdvice](t, s, "order?limit=200")
		if got := figuresOf(t, orderLine(t, order, platformQB)); got != tc.want {
			t.Errorf("%s players: %+v, want %+v", tc.name, got, tc.want)
		}
		// The turned screens (Waivers, Trades) read the same rule: their
		// advisor turns to week 7 and keeps the platform's week 6.
		a, err := s.leagueAdvisor(t.Context(), s.Leagues.(fakeLeagues).league, uuid.Nil, t.Context(), actionWeek)
		if err != nil {
			t.Fatal(err)
		}
		team, _ := a.Snap.TeamByRoster(1)
		qb := a.build(platformQBHost, a.Player(platformQBHost), a.side(team.RosterID))
		if got := figuresOf(t, qb.line); got != tc.want {
			t.Errorf("%s turned (week %d): %+v, want %+v", tc.name, a.week, got, tc.want)
		}
		if qb.cand.HasPerGame != true || qb.cand.PerGame != tc.want.avg {
			t.Errorf("%s: the engine's points a game %v, want the column's %v", tc.name, qb.cand.PerGame, tc.want.avg)
		}
	}
}

// A player the platform scores 0 in a final game sat or scored nothing: no
// game is counted from it, so his GP does not grow and no Last of 0 shows.
func TestAZeroFromThePlatformIsNoGame(t *testing.T) {
	s, _ := platformFixture(t, mondayNight)
	line := lineupLine(t, decode[apitypes.LineupAdvice](t, s, "lineup"), "p001")
	if line.GamesPlayed != nil || line.LastPoints != nil || len(line.Facts.LastGames) != 0 {
		t.Fatalf("the backup who sat: games %v last %v %v", line.GamesPlayed, line.LastPoints, line.Facts.LastGames)
	}
}

// The platform's week is its own: once it reads week 7 (Thursday), its
// points are week 7's, none final, and week 6 is our stats' alone.
func TestThePlatformsPointsAreItsWeeksOnly(t *testing.T) {
	s, f := platformFixture(t, thursdayMorning)
	if f.league.Snap.Week != 7 {
		t.Fatalf("the platform's week %d", f.league.Snap.Week)
	}
	got := figuresOf(t, lineupLine(t, decode[apitypes.LineupAdvice](t, s, "lineup"), platformQB))
	if want := (seasonFigures{last: 28, avg: 13, games: 6, week: 6, source: apitypes.GamePointsSourceStats}); got != want {
		t.Fatalf("Thursday: %+v, want %+v", got, want)
	}
}
