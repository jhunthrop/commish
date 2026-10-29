package leaguesync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// espnRecorded is a recorded ESPN league through the whole read.
func espnRecorded(t *testing.T, file string, season int) espn.FullLeague {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "espn", "testdata", file))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	l, err := (&espn.Client{HTTP: srv.Client(), Base: srv.URL}).Read(context.Background(), "48153503", season, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func gamesIn(games []ScheduledGame, week int) []ScheduledGame {
	var out []ScheduledGame
	for _, g := range games {
		if g.Week == week {
			out = append(out, g)
		}
	}
	return out
}

// ESPN keeps every regular-season period the league read already carries
// (Lane 298): the recorded 2026 league in week 6 has fourteen weeks of six
// games, weeks 1 to 5 final with both sides' points, week 6 and after
// pairings alone; the playoffs' periods are left out.
func TestESPNKeepsTheWholeRegularSeason(t *testing.T) {
	snap := espnSnapshot(espnRecorded(t, "league-inplay-2026-week6.json", 2026), time.Now())
	if weeks := Weeks(snap.Schedule); len(weeks) != 14 || weeks[0] != 1 || weeks[13] != 14 {
		t.Fatalf("weeks %v, want 1 to 14", weeks)
	}
	for week := 1; week <= 14; week++ {
		games := gamesIn(snap.Schedule, week)
		if len(games) != 6 {
			t.Fatalf("week %d: %d games, want 6", week, len(games))
		}
		for _, g := range games {
			if !g.HeadToHead() || g.Final != (week <= 5) || g.Scored() != (week <= 5) {
				t.Fatalf("week %d game %+v", week, g)
			}
		}
	}
	if got := WeekScores(snap.Schedule, 1); len(got) != 12 {
		t.Fatalf("week 1 scores %v, want twelve teams", got)
	}
}

// FFPC keeps the schedule page it already parses: the recorded Big
// Gorilla league in week 6 has head-to-head weeks 1 to 5 final and scored,
// week 6 all-play as a game against the field for every team, and weeks 7
// to 13 as pairings.
func TestFFPCKeepsTheParsedWeeks(t *testing.T) {
	page, err := os.ReadFile(filepath.Join("..", "hosts", "ffpc", "testdata", "ffpc-schedule.html"))
	if err != nil {
		t.Fatal(err)
	}
	weeks, err := ffpc.ParseSchedule(page)
	if err != nil {
		t.Fatal(err)
	}
	teams := make([]Team, 12)
	for i := range teams {
		teams[i].RosterID = i + 1
	}
	games := ffpcSchedule(weeks, teams, 6, time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC))
	for _, g := range gamesIn(games, 1) {
		if !g.HeadToHead() || !g.Final || !g.Scored() {
			t.Fatalf("week 1 game %+v", g)
		}
	}
	field := gamesIn(games, 6)
	if len(field) != 12 {
		t.Fatalf("week 6: %d games, want one against the field for each of twelve teams", len(field))
	}
	for _, g := range field {
		if g.Against != AgainstField || g.Final || g.Scored() {
			t.Fatalf("week 6 game %+v", g)
		}
	}
	if g := gamesIn(games, 13); len(g) == 0 || g[0].Final {
		t.Fatalf("week 13 %+v", g)
	}
}

// Sleeper's week reads pair the recorded sides by matchup id: a past week
// is final with each side's points, a week to come pairings alone, and in
// a league that plays the median each team has a game against it too.
func TestSleeperWeeksFromRecordedMatchups(t *testing.T) {
	read := func(file string) []sleeper.Matchup {
		body, err := os.ReadFile(filepath.Join("testdata", "schedule", file))
		if err != nil {
			t.Fatal(err)
		}
		m, err := sleeper.DecodeMatchups(body)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	past := sleeperWeek(read("sleeper-matchups-week3.json"), 3, true, false)
	if len(past) != 6 {
		t.Fatalf("week 3: %d games, want 6", len(past))
	}
	first := past[0]
	if !first.HeadToHead() || !first.Final || first.RosterIDs[0] != 1 || first.RosterIDs[1] != 4 || first.Points[0] != 141.54 || first.Points[1] != 131.88 {
		t.Fatalf("week 3's first game %+v", first)
	}
	ahead := sleeperWeek(read("sleeper-matchups-week12.json"), 12, false, false)
	if len(ahead) != 6 || ahead[0].Final || ahead[0].Scored() {
		t.Fatalf("week 12 %+v", ahead)
	}
	median := sleeperWeek(read("sleeper-matchups-week3.json"), 3, true, true)
	n := 0
	for _, g := range median {
		if g.Against == AgainstMedian {
			n++
		}
	}
	if n != 12 || len(WeekScores(median, 3)) != 12 {
		t.Fatalf("a median league's week: %d median games", n)
	}
	snap := Snapshot{Week: 7}
	if !playedBefore(snap, 6) || playedBefore(snap, 7) {
		t.Fatal("a week before the current one is played, the current one is not")
	}
}

// Yahoo's per-week scoreboard (constructed from the documented answer):
// two games Yahoo scored final, each with both sides' points.
func TestYahooWeekFromTheScoreboard(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "hosts", "yahoo", "testdata", "yahoo-scoreboard-week5.xml"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := yahoo.ParseScoreboard(body)
	if err != nil {
		t.Fatal(err)
	}
	games := yahooWeek(b)
	if len(games) != 2 || games[0].Week != 5 || !games[0].Final || games[0].Points[0] != 121.36 || games[1].RosterIDs[1] != 4 {
		t.Fatalf("games %+v", games)
	}
}

// MyFantasyLeague's schedule export (recorded 2026-10-29 from the public
// league 10010): fourteen regular-season weeks (15 to 17 list none), each
// with six head-to-head games and a
// game against the week's average for every franchise; weeks 1 to 7
// scored, final only before the league's current week.
func TestMFLScheduleFromTheRecordedExport(t *testing.T) {
	games, err := mfl.DecodeSchedule(replayFile("mfl/schedule.json"))
	if err != nil {
		t.Fatal(err)
	}
	snap := Snapshot{Week: 8}
	var kept []ScheduledGame
	for _, g := range games {
		kept = append(kept, mflGame(snap, g))
	}
	week1 := gamesIn(kept, 1)
	h2h, avg := 0, 0
	for _, g := range week1 {
		switch {
		case g.HeadToHead():
			h2h++
		case g.Against == AgainstAverage && len(g.RosterIDs) == 1:
			avg++
		}
		if !g.Final || !g.Scored() {
			t.Fatalf("week 1 game %+v", g)
		}
	}
	if h2h != 6 || avg != 12 {
		t.Fatalf("week 1: %d head-to-head, %d against the average", h2h, avg)
	}
	if s := WeekScores(kept, 1); s[12] != 184.46 || s[1] != 121.54 {
		t.Fatalf("week 1 scores %v", s)
	}
	for _, g := range gamesIn(kept, 8) {
		if g.Final || g.Scored() {
			t.Fatalf("week 8 game %+v", g)
		}
	}
	if len(Weeks(kept)) != 14 {
		t.Fatalf("weeks %v", Weeks(kept))
	}
}
