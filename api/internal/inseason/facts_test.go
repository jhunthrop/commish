package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/season"
)

var east = season.Eastern()

func game(week int, home, away string, kickoff time.Time, final bool) []boards.TeamWeek {
	return []boards.TeamWeek{
		{Week: week, Team: home, Opponent: away, Home: true, Kickoff: kickoff, Final: final},
		{Week: week, Team: away, Opponent: home, Home: false, Kickoff: kickoff, Final: final},
	}
}

func rushing(id, team string, week int, yards float64) boards.StatLine {
	return boards.StatLine{PlayerID: id, Position: "RB", Week: week, Team: team, Metrics: map[string]float64{"rushing_yards": yards}}
}

// fixtureSeason is four clubs over three weeks: weeks 1 and 2 final,
// week 3 Miami at home to New England on Thursday (final), Buffalo and
// the Jets on bye. Points are rushing yards over ten, standard scoring.
func fixtureSeason(now time.Time) *Season {
	var games []boards.TeamWeek
	for _, g := range [][]boards.TeamWeek{
		game(1, "BUF", "MIA", time.Date(2026, 9, 13, 13, 0, 0, 0, east), true),
		game(1, "NE", "NYJ", time.Date(2026, 9, 13, 13, 0, 0, 0, east), true),
		game(2, "BUF", "NE", time.Date(2026, 9, 20, 13, 0, 0, 0, east), true),
		game(2, "NYJ", "MIA", time.Date(2026, 9, 20, 13, 0, 0, 0, east), true),
		game(3, "MIA", "NE", time.Date(2026, 9, 24, 20, 15, 0, 0, east), true),
	} {
		games = append(games, g...)
	}
	data := Data{
		Games: games,
		Lines: []boards.StatLine{
			rushing("mia-rb", "MIA", 1, 200), rushing("mia-rb", "MIA", 2, 100), rushing("mia-rb", "MIA", 3, 50),
			rushing("buf-rb", "BUF", 1, 50), rushing("buf-rb", "BUF", 2, 150),
			rushing("ne-rb", "NE", 1, 300), rushing("ne-rb", "NE", 2, 120), rushing("ne-rb", "NE", 3, 80),
		},
		Designations: map[string]boards.Designation{
			"buf-rb": {Code: "D", AsOf: time.Date(2026, 9, 25, 16, 10, 0, 0, time.UTC)},
			"ne-rb":  {Code: "X", AsOf: time.Date(2026, 9, 25, 16, 10, 0, 0, time.UTC)},
		},
	}
	return NewSeason(data, RulesOf(scoring.Standard()), 3, now)
}

func TestWeekFacts(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	s := fixtureSeason(saturday)

	mia := s.For(Player{BoardID: "mia-rb", Team: "MIA", Position: draft.RB})
	if mia.Opponent != "NE" || mia.Home == nil || !*mia.Home || !mia.Played || !mia.Locked || mia.Bye {
		t.Fatalf("Miami's back %v", mia)
	}
	if len(mia.LastGames) != 3 || mia.LastGames[0] != (GamePoints{3, 5}) || mia.LastGames[2] != (GamePoints{1, 20}) {
		t.Fatalf("last games %v, want newest first", mia.LastGames)
	}
	if mia.PerGame == nil || *mia.PerGame != 11.7 {
		t.Fatalf("per game %v", mia.PerGame)
	}
	// New England allowed Buffalo's 15 and Miami's 5 in three final games.
	if a := mia.Allowed; a == nil || a.PointsAGame != 6.7 || a.Rank != 2 || a.Of != 4 || a.Position != draft.RB {
		t.Fatalf("allowed %+v", mia.Allowed)
	}
	if mia.Designation != nil || mia.Tier() != Available {
		t.Fatalf("no designation is none: %+v", mia.Designation)
	}

	buf := s.For(Player{BoardID: "buf-rb", Team: "BUF", Position: draft.RB})
	if !buf.Bye || buf.Opponent != "" || buf.Allowed != nil || buf.Kickoff != nil || buf.Tier() != Out {
		t.Fatalf("Buffalo's back is on bye: %v", buf)
	}
	if buf.Designation == nil || buf.Designation.Status != boards.StatusDoubtful {
		t.Fatalf("designation %+v", buf.Designation)
	}

	ne := s.For(Player{BoardID: "ne-rb", Team: "NE", Position: draft.RB})
	if ne.Designation != nil {
		t.Fatalf("an unknown code shows no designation: %+v", ne.Designation)
	}

	read := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	ir := s.For(Player{BoardID: "nobody", Team: "NE", Position: draft.WR, HostIR: true, ReadAt: read})
	if ir.Designation == nil || ir.Designation.Status != boards.StatusInjuredReserve || !ir.Designation.AsOf.Equal(read) || !ir.InjuredReserve() {
		t.Fatalf("the host's IR mark: %+v", ir.Designation)
	}
	if ir.PerGame != nil || ir.LastGames != nil {
		t.Fatalf("a player with no lines has no points: %v", ir)
	}

	unknown := s.For(Player{BoardID: "x", Position: draft.WR})
	if unknown.Bye || unknown.Opponent != "" || unknown.Home != nil {
		t.Fatalf("a player with no team has no schedule facts: %v", unknown)
	}
}

// Points allowed rank among the defenses, fewest first: Miami 13 over
// three, New England 20 over three, Buffalo 32 over two, the Jets 40
// over two.
func TestPointsAllowedRanks(t *testing.T) {
	s := fixtureSeason(time.Date(2026, 9, 26, 12, 0, 0, 0, east))
	want := map[string]Allowed{
		"MIA": {4.3, 1, 4, draft.RB}, "NE": {6.7, 2, 4, draft.RB}, "BUF": {16, 3, 4, draft.RB}, "NYJ": {20, 4, 4, draft.RB},
	}
	for team, a := range want {
		if got := s.allowed[teamPosition{team, draft.RB}]; got != a {
			t.Errorf("%s: %+v, want %+v", team, got, a)
		}
	}
}

// A game not yet final counts for nobody's points, and a game that has
// kicked off locks his row.
func TestUnfinishedGamesAndKickoff(t *testing.T) {
	sunday := time.Date(2026, 10, 4, 13, 30, 0, 0, east)
	data := Data{
		Games: game(4, "BUF", "MIA", time.Date(2026, 10, 4, 13, 0, 0, 0, east), false),
		Lines: []boards.StatLine{rushing("buf-rb", "BUF", 4, 90)},
	}
	s := NewSeason(data, RulesOf(scoring.Standard()), 4, sunday)
	f := s.For(Player{BoardID: "buf-rb", Team: "BUF", Position: draft.RB})
	if f.Played || !f.Locked || f.LastGames != nil {
		t.Fatalf("an unfinished game: %v", f)
	}
	before := NewSeason(data, RulesOf(scoring.Standard()), 4, sunday.Add(-time.Hour))
	if before.For(Player{BoardID: "buf-rb", Team: "BUF", Position: draft.RB}).Locked {
		t.Fatal("locked before kickoff")
	}
}
