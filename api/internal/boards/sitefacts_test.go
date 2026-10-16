package boards

import (
	"context"
	"testing"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The postseason's last week and game day are read when the schedule
// carries postseason games, and not otherwise.
func TestPostseasonEnd(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "postseason_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.provider_games (season int, week int, game_date date, kickoff_et text)`,
		`insert into ` + schema + `.provider_games values
			(2026, 18, '2027-01-10', '1:00p'), (2026, 19, '2027-01-16', '4:30p'),
			(2026, 22, '2027-02-14', '6:30p'), (2027, 18, '2028-01-09', '1:00p')`,
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
	week, day, ok, err := src.PostseasonEnd(ctx, 2026)
	if err != nil || !ok || week != 22 || day.Format("2006-01-02") != "2027-02-14" || day.Location().String() != "America/New_York" {
		t.Fatalf("2026's postseason end week %d %v %v (%v)", week, day, ok, err)
	}
	if _, _, ok, err := src.PostseasonEnd(ctx, 2027); err != nil || ok {
		t.Fatalf("2027 has no postseason game: %v (%v)", ok, err)
	}
}

// The site's season asks which week the published board starts from: only
// a rest-of-season run that says its week answers.
func TestBoardWeek(t *testing.T) {
	pool, src := publishedFixture(t, true)
	ctx := context.Background()
	week := func() (int, bool) {
		t.Helper()
		w, ok, err := src.BoardWeek(ctx, 2026)
		if err != nil {
			t.Fatal(err)
		}
		return w, ok
	}
	if _, ok := week(); ok {
		t.Fatal("answered with no published rows")
	}
	publishRun(t, pool, "2026-10-21T12", "rest_of_season", "ppr,p1,242.5,null", "ppr,p2,195.3,null")
	if _, ok := week(); ok {
		t.Fatal("answered before the from_week column")
	}
	if _, err := pool.Exec(ctx, "alter table "+publishedSchema+".published_boards add column from_week int"); err != nil {
		t.Fatal(err)
	}
	if _, ok := week(); ok {
		t.Fatal("answered with a null from_week")
	}
	if _, err := pool.Exec(ctx, "update "+publishedSchema+".published_boards set from_week = 7"); err != nil {
		t.Fatal(err)
	}
	if w, ok := week(); !ok || w != 7 {
		t.Fatalf("week %d %v, want 7", w, ok)
	}
	if _, err := pool.Exec(ctx, "update "+publishedSchema+".published_boards set order_basis = 'preseason'"); err != nil {
		t.Fatal(err)
	}
	if _, ok := week(); ok {
		t.Fatal("answered for a preseason run")
	}
}
