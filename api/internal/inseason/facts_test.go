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

// fixtureGames is the fixture season's schedule.
func fixtureGames() []boards.TeamWeek {
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
	return games
}

// irSince is when the fixture's injured-reserve receiver's run began.
var irSince = time.Date(2026, 9, 22, 22, 0, 0, 0, time.UTC)

// fixtureSeason is four clubs over three weeks: weeks 1 and 2 final,
// week 3 Miami at home to New England on Thursday (final), Buffalo and
// the Jets on bye. Points are rushing yards over ten, standard scoring.
func fixtureSeason(now time.Time) *Season {
	data := Data{
		Games: fixtureGames(),
		Lines: []boards.StatLine{
			rushing("mia-rb", "MIA", 1, 200), rushing("mia-rb", "MIA", 2, 100), rushing("mia-rb", "MIA", 3, 50),
			rushing("buf-rb", "BUF", 1, 50), rushing("buf-rb", "BUF", 2, 150),
			rushing("ne-rb", "NE", 1, 300), rushing("ne-rb", "NE", 2, 120), rushing("ne-rb", "NE", 3, 80),
		},
		Designations: map[string]boards.Designation{
			"buf-rb": {Code: "D", AsOf: time.Date(2026, 9, 25, 16, 10, 0, 0, time.UTC)},
			"ne-rb":  {Code: "X", AsOf: time.Date(2026, 9, 25, 16, 10, 0, 0, time.UTC)},
			"mia-wr": {Code: "IR", AsOf: time.Date(2026, 9, 25, 16, 10, 0, 0, time.UTC), Since: &irSince},
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

	// A season-long status carries its start, as the board's does (review 66n finding 3).
	held := s.For(Player{BoardID: "mia-wr", Team: "MIA", Position: draft.WR})
	if d := held.Designation; d == nil || d.Status != boards.StatusInjuredReserve || d.Since == nil || !d.Since.Equal(irSince) {
		t.Fatalf("a season-long designation's start: %+v", held.Designation)
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

// kicking is a kicker's line from the kicking source: field goals and
// extra points made, and the misses only that source writes.
func kicking(id, team string, week int, fieldGoals, extraPoints float64) boards.StatLine {
	return boards.StatLine{PlayerID: id, Position: "K", Week: week, Team: team,
		Metrics: map[string]float64{"field_goals_made": fieldGoals, "extra_points_made": extraPoints,
			"field_goals_missed": 0, "extra_points_missed": 0}}
}

// published is a kicker's line from the published stats alone, which
// write his kicking as zero.
func published(id, team string, week int) boards.StatLine {
	return boards.StatLine{PlayerID: id, Position: "K", Week: week, Team: team,
		Metrics: map[string]float64{"field_goals_made": 0, "extra_points_made": 0}}
}

// A week the kicking source has not written (it lags, skips or misses a
// kicker) is no game: a real week counts, the zero week is left out of
// his last games, his points a game and the points allowed to kickers,
// and a club no counted kicker line played is not ranked at all.
func TestMixedKickerWeeks(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	data := Data{Games: fixtureGames(), Lines: []boards.StatLine{
		kicking("mia-k", "MIA", 1, 2, 3), published("mia-k", "MIA", 2), published("ne-k", "NE", 1),
	}}
	s := NewSeason(data, RulesOf(scoring.Standard()), 3, saturday)
	k := s.For(Player{BoardID: "mia-k", Team: "MIA", Position: draft.K})
	if len(k.LastGames) != 1 || k.LastGames[0] != (GamePoints{1, 9}) || k.PerGame == nil || *k.PerGame != 9 {
		t.Fatalf("a kicker's real week alone: %v per game %v", k, k.PerGame)
	}
	if a, ok := s.allowed[teamPosition{"BUF", draft.K}]; !ok || a.PointsAGame != 9 || a.Rank != 1 || a.Of != 1 {
		t.Fatalf("Buffalo, the one club a counted kicker played: %+v %v", a, ok)
	}
	for _, club := range []string{"NE", "NYJ", "MIA"} {
		if a, ok := s.allowed[teamPosition{club, draft.K}]; ok {
			t.Errorf("%s ranked against kickers with no counted kicker line: %+v", club, a)
		}
	}
	if ne := s.For(Player{BoardID: "ne-k", Team: "NE", Position: draft.K}); ne.LastGames != nil || ne.PerGame != nil {
		t.Fatalf("a kicker with zero weeks alone: %v", ne)
	}
}

// A store whose kickers' lines carry no kicking (the player-week source
// writes them as zeros) holds no results for kickers: no last games, no
// points a game, no points allowed to kickers, never a row of zeros; a
// back's results stand.
func TestZeroKickingIsNoResult(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	data := Data{Games: fixtureGames(), Lines: []boards.StatLine{
		rushing("mia-rb", "MIA", 1, 200), published("mia-k", "MIA", 1), published("mia-k", "MIA", 2),
		published("ne-k", "NE", 1),
	}}
	zero := NewSeason(data, RulesOf(scoring.Standard()), 3, saturday)
	k := zero.For(Player{BoardID: "mia-k", Team: "MIA", Position: draft.K})
	if k.LastGames != nil || k.PerGame != nil || k.Allowed != nil {
		t.Fatalf("zero kicking read as results: %v, allowed %+v", k, k.Allowed)
	}
	if _, ranked := zero.allowed[teamPosition{"NE", draft.K}]; ranked {
		t.Fatal("points allowed to kickers ranked from zeros")
	}
	if rb := zero.For(Player{BoardID: "mia-rb", Team: "MIA", Position: draft.RB}); rb.PerGame == nil || *rb.PerGame != 20 {
		t.Fatalf("a back's results: %v", rb)
	}
	if zero.Carries("field_goals_made") || !zero.Carries("rushing_yards") {
		t.Fatal("zero kicking counted as carried, or rushing not")
	}
}

// Real kicking and a defense's line are results: a kicker's last games
// and points a game, points allowed to kickers ranked from them, and a
// defense's games under the league's tiers.
func TestKickerAndDefenseResults(t *testing.T) {
	saturday := time.Date(2026, 9, 26, 12, 0, 0, 0, east)
	defense := boards.StatLine{PlayerID: "DST-MIA", Position: "DEF", Week: 1, Team: "MIA",
		Metrics: map[string]float64{"sacks": 3, "points_allowed": 10, "yards_allowed": 280}}
	data := Data{Games: fixtureGames(), Lines: []boards.StatLine{
		kicking("mia-k", "MIA", 1, 2, 3), kicking("mia-k", "MIA", 2, 1, 1), kicking("buf-k", "BUF", 1, 0, 2), defense,
	}}
	real := NewSeason(data, RulesOf(scoring.Standard()), 3, saturday)
	k := real.For(Player{BoardID: "mia-k", Team: "MIA", Position: draft.K})
	if len(k.LastGames) != 2 || k.LastGames[0] != (GamePoints{2, 4}) || k.LastGames[1] != (GamePoints{1, 9}) || k.PerGame == nil || *k.PerGame != 6.5 {
		t.Fatalf("a kicker's results: %v per game %v", k, k.PerGame)
	}
	// Buffalo allowed Miami's kicker 9 in week 1, the Jets 4 in week 2,
	// Miami Buffalo's 2; New England played no counted kicker.
	if a := real.allowed[teamPosition{"BUF", draft.K}]; a.Rank != 3 || a.Of != 3 || a.PointsAGame != 9 {
		t.Fatalf("allowed to kickers %+v", a)
	}
	if _, ok := real.allowed[teamPosition{"NE", draft.K}]; ok {
		t.Fatal("New England ranked against kickers it never played")
	}
	// 3 sacks, 7 to 13 allowed (3) and 200 to 299 yards (2).
	d := real.For(Player{BoardID: "DST-MIA", Team: "MIA", Position: draft.DEF})
	if len(d.LastGames) != 1 || d.LastGames[0].Points != 8 {
		t.Fatalf("a defense's results: %v", d)
	}
	if !real.Carries("points_allowed") || !real.Carries("yards_allowed") || real.Carries("safeties") {
		t.Fatal("carried metrics")
	}
}
