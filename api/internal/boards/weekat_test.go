package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/season"
)

// A week runs from the day after the previous week's last game day to
// the end of its own, Eastern: on Tuesday Oct 13 2026, after week 5's
// Monday game, the week is 6, as FFPC's own week 6 (10/13 to 10/20) is.
func TestWeekAt(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekat_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.provider_games (season int, week int, game_date date, kickoff_et text)`,
		`insert into ` + schema + `.provider_games values
			(2026, 5, '2026-10-08', '8:15p'), (2026, 5, '2026-10-12', '8:15p'),
			(2026, 6, '2026-10-15', '8:15p'), (2026, 6, '2026-10-19', '8:15p'),
			(2025, 6, '2025-10-13', '8:15p')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	east := season.Eastern()
	cases := []struct {
		at   time.Time
		want int
		ok   bool
	}{
		{time.Date(2026, 10, 12, 23, 0, 0, 0, east), 5, true},
		{time.Date(2026, 10, 13, 9, 0, 0, 0, east), 6, true},
		{time.Date(2026, 10, 19, 23, 59, 0, 0, east), 6, true},
		{time.Date(2026, 10, 20, 0, 0, 0, 0, east), 0, false},
	}
	for _, c := range cases {
		week, ok, err := src.WeekAt(ctx, 2026, c.at)
		if err != nil || week != c.want || ok != c.ok {
			t.Fatalf("at %v: week %d %v (%v), want %d %v", c.at, week, ok, err, c.want, c.ok)
		}
	}
}

// The site's season reads the regular season's last game day (week 18
// and before, so a postseason game, should one be loaded, never stretches
// it) and whether a season's preseason board is stored.
func TestLastGameDayAndPreseasonBoard(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "siteseason_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.provider_games (season int, week int, game_date date, kickoff_et text)`,
		`insert into ` + schema + `.provider_games values
			(2026, 1, '2026-09-09', '8:20p'), (2026, 18, '2027-01-09', '4:30p'), (2026, 18, '2027-01-10', '1:00p'),
			(2026, 19, '2027-01-16', '4:30p')`,
		`create table ` + schema + `.preseason_projections (season int, source text, player_id text, as_of timestamptz)`,
		`insert into ` + schema + `.preseason_projections values (2026, 'model', 'p1', now())`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	last, ok, err := src.LastGameDay(ctx, 2026)
	if err != nil || !ok || last.Format("2006-01-02") != "2027-01-10" || last.Location().String() != "America/New_York" {
		t.Fatalf("2026's last game day %v %v (%v)", last, ok, err)
	}
	if _, ok, err := src.LastGameDay(ctx, 2027); err != nil || ok {
		t.Fatalf("2027 has no schedule: %v (%v)", ok, err)
	}
	for y, want := range map[int]bool{2026: true, 2027: false} {
		if got, err := src.PreseasonBoard(ctx, y); err != nil || got != want {
			t.Fatalf("%d's preseason board %v (%v), want %v", y, got, err, want)
		}
	}
}
