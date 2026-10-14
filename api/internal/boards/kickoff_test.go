package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The schedule's kickoff text is Eastern: 2026's opener, "8:20p" on Sep
// 9, is 00:20 UTC on Sep 10.
func TestKickoffAt(t *testing.T) {
	date := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		text string
		want time.Time
	}{
		{"8:20p", time.Date(2026, 9, 10, 0, 20, 0, 0, time.UTC)},
		{"1:00p", time.Date(2026, 9, 9, 17, 0, 0, 0, time.UTC)},
		{"12:00p", time.Date(2026, 9, 9, 16, 0, 0, 0, time.UTC)},
		{"9:30a", time.Date(2026, 9, 9, 13, 30, 0, 0, time.UTC)},
		{"", time.Date(2026, 9, 9, 4, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		got, err := KickoffAt(date, c.text)
		if err != nil || !got.Equal(c.want) {
			t.Errorf("%q: %s, %v; want %s", c.text, got.UTC(), err, c.want)
		}
	}
	for _, bad := range []string{"8:20", "25:00p", "8:61p", "noon"} {
		if _, err := KickoffAt(date, bad); err == nil {
			t.Errorf("%q: no error", bad)
		}
	}
}

// kickoffSchema is a scratch schema shaped like the research schedule,
// on the test database, dropped when the test ends.
const kickoffSchema = "boards_kickoff_test"

// FirstKickoff reads week 1 of the schedule and takes its earliest game,
// in Eastern time: 2026's opener, 8:20 pm on Sep 9, is 00:20 UTC on Sep
// 10, ahead of the Sunday games and of a week 2 game. A season whose week
// 1 is not loaded answers false, and a week 1 with no kickoff text starts
// its day.
func TestFirstKickoffFromTheSchedule(t *testing.T) {
	url := dbtest.URL(t)
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+kickoffSchema+" cascade")
		pool.Close()
	})
	for _, stmt := range []string{
		"drop schema if exists " + kickoffSchema + " cascade",
		"create schema " + kickoffSchema,
		"create table " + kickoffSchema + ".provider_games (season int, week int, game_date date, kickoff_et text)",
		"insert into " + kickoffSchema + ".provider_games values (2026, 1, '2026-09-13', '1:00p'), (2026, 1, '2026-09-09', '8:20p'), " +
			"(2026, 2, '2026-09-08', '8:20p'), (2026, 1, null, '9:30a'), (2025, 1, '2025-09-04', null)",
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, kickoffSchema, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		season int
		want   time.Time
		found  bool
	}{
		{2026, time.Date(2026, 9, 10, 0, 20, 0, 0, time.UTC), true},
		{2025, time.Date(2025, 9, 4, 4, 0, 0, 0, time.UTC), true},
		{2027, time.Time{}, false},
	}
	for _, c := range cases {
		got, found, err := src.FirstKickoff(ctx, c.season)
		if err != nil || found != c.found || !got.Equal(c.want) {
			t.Errorf("%d: %s %v %v, want %s %v", c.season, got.UTC(), found, err, c.want, c.found)
		}
	}
}
