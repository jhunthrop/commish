package espn

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The in-play fixture is a real public league as ESPN answered the whole
// read with mMatchupScore and mScoreboard (2026, scoring period 6, read
// 2026-10-19 02:55Z with Sunday's afternoon games final and the night
// game on), trimmed to the reader's fields with every member's id and
// name and every team's name replaced (Lane 74).
const inPlayFixture = "testdata/league-inplay-2026-week6.json"

// readBody is one body through the whole read, as ESPN would answer it.
func readBody(t *testing.T, body []byte, season int) FullLeague {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	l, err := (&Client{HTTP: srv.Client(), Base: srv.URL}).Read(context.Background(), "48153503", season, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// gameOf is the current period's game a team plays in.
func gameOf(t *testing.T, l FullLeague, team int) Game {
	t.Helper()
	for _, g := range l.Games {
		if g.Home == team || g.Away == team {
			return g
		}
	}
	t.Fatalf("team %d has no game in period %d", team, l.MatchupPeriod)
	return Game{}
}

// Lane 74: a week in play scores each side by ESPN's totalPointsLive.
// mMatchup's totalPoints stays 0.0 until ESPN decides the matchup, which
// is why every side of the production league read PTS 0.0 on Sunday.
func TestReadInPlayWeekScoresLive(t *testing.T) {
	l := readBody(t, readFixture(t, inPlayFixture), 2026)
	if l.ScoringPeriod != 6 || l.MatchupPeriod != 6 || len(l.Games) != 6 {
		t.Fatalf("period %d/%d, %d games", l.ScoringPeriod, l.MatchupPeriod, len(l.Games))
	}
	g := gameOf(t, l, 9)
	if g.Home != 9 || g.Away != 3 || g.HomePoints != 68.08 || g.Points != 76.8 || g.HomeUnread || g.Unread {
		t.Fatalf("game 9 v 3: %+v", g)
	}
	if g := gameOf(t, l, 4); g.HomePoints != 113.3 || g.Points != 120.68 {
		t.Fatalf("game 4 v 1: %+v", g)
	}
	for _, g := range l.Games {
		if g.HomeUnread || g.Unread || g.HomePoints == 0 || g.Points == 0 {
			t.Fatalf("a side left unscored: %+v", g)
		}
	}
}

// A decided week reads ESPN's final totalPoints on both sides, and the
// final wins over live points the read still carries (the Tuesday
// before the period rolls, a stat correction).
func TestReadDecidedWeekScoresFinal(t *testing.T) {
	l := readBody(t, readFixture(t, fullFixture), 2019)
	g := l.Games[0]
	if g.Home != 3 || g.Away != 9 || g.HomePoints != 84 || g.Points != 90 || g.HomeUnread || g.Unread {
		t.Fatalf("a decided game: %+v", g)
	}
	const live = `"winner":"UNDECIDED","home":{"teamId":9,"totalPoints":0.0,"totalPointsLive":68.08},"away":{"teamId":3,"totalPoints":0.0,"totalPointsLive":76.8}`
	in := string(readFixture(t, inPlayFixture))
	if !strings.Contains(in, live) {
		t.Fatal("the fixture's game 9 v 3 moved")
	}
	decided := strings.Replace(in, live,
		`"winner":"AWAY","home":{"teamId":9,"totalPoints":70.1,"totalPointsLive":68.08},"away":{"teamId":3,"totalPoints":79.2,"totalPointsLive":76.8}`, 1)
	if g := gameOf(t, readBody(t, []byte(decided), 2026), 9); g.HomePoints != 70.1 || g.Points != 79.2 || g.HomeUnread || g.Unread {
		t.Fatalf("a decided game carrying live points: %+v", g)
	}
}

// noLive is the in-play read with ESPN's live points gone.
func noLive(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(string(readFixture(t, inPlayFixture)), `"totalPointsLive"`, `"elsewhere"`)
}

// An undecided game whose starters have kicked off (lineupLocked) and
// whose read carries no live points is unread, never a 0.0 a member
// would take for the score.
func TestReadUndecidedWithoutLiveIsUnread(t *testing.T) {
	l := readBody(t, []byte(noLive(t)), 2026)
	for _, g := range l.Games {
		if !g.HomeUnread || !g.Unread {
			t.Fatalf("an undecided game without live points read as scored: %+v", g)
		}
	}
}

// Before any starter kicks off (Tuesday to Thursday) a side with no live
// points has scored 0.0, read, not a read that failed.
func TestReadBeforeKickoffWithoutLiveIsZero(t *testing.T) {
	body := strings.ReplaceAll(noLive(t), `"lineupLocked":true`, `"lineupLocked":false`)
	for _, g := range readBody(t, []byte(body), 2026).Games {
		if g.HomeUnread || g.Unread || g.HomePoints != 0 || g.Points != 0 {
			t.Fatalf("a game before kickoff: %+v", g)
		}
	}
}

// The whole read decodes as it streams behind its limit: a body past it
// is malformed, never held whole.
func TestReadOverLimitIsMalformed(t *testing.T) {
	big := `{"id":1,"pad":"` + strings.Repeat("x", maxLeagueBody) + `","teams":[{}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(big)) }))
	t.Cleanup(srv.Close)
	_, err := (&Client{HTTP: srv.Client(), Base: srv.URL}).Read(context.Background(), "48153503", 2026, nil)
	if !errors.Is(err, ErrMalformed) {
		t.Fatalf("an over-limit read: %v", err)
	}
}

// The week moves with ESPN: once ESPN's scoringPeriodId and
// currentMatchupPeriod advance, the read is the new period's games.
func TestReadWeekAdvancesWithESPN(t *testing.T) {
	body := strings.NewReplacer(`"scoringPeriodId":6`, `"scoringPeriodId":7`, `"currentMatchupPeriod":6`, `"currentMatchupPeriod":7`).
		Replace(string(readFixture(t, inPlayFixture)))
	l := readBody(t, []byte(body), 2026)
	if l.ScoringPeriod != 7 || l.MatchupPeriod != 7 || len(l.Games) != 6 {
		t.Fatalf("period %d/%d, %d games", l.ScoringPeriod, l.MatchupPeriod, len(l.Games))
	}
	if g := gameOf(t, l, 9); g.Home == 9 && g.Away == 3 {
		t.Fatalf("still week 6's pairing: %+v", g)
	}
}
