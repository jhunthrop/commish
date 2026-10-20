package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// registerSchema is a scratch schema shaped like the register's tables the
// league record reads (Lane 93), dropped when the test ends.
const registerSchema = "boards_register_test"

func registerFixture(t *testing.T, tables bool) *PGSource {
	t.Helper()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+registerSchema+" cascade")
		pool.Close()
	})
	s := registerSchema
	stmts := []string{"drop schema if exists " + s + " cascade", "create schema " + s}
	if tables {
		stmts = append(stmts,
			"create table "+s+".players (id text primary key, espn_id text)",
			"create table "+s+".register_freeze_rows (season int, week int, frozen_at timestamptz, board_source text, "+
				"player_id text, board_rank int, published_points float8)",
			"create table "+s+".register_grade_rows (season int, week int, frozen_at timestamptz, graded_at timestamptz, "+
				"board_source text, player_id text)",
			"insert into "+s+".players values ('00-a', '3116593'), ('00-b', '16733'), ('00-c', null)",
			// Week 6 kept only the preseason board; week 7's early freeze is superseded by the Thursday one.
			"insert into "+s+".register_freeze_rows values "+
				"(2026, 6, '2026-10-13T12:00:00Z', 'commish_board_v9_ppr_12', '00-a', 1, null), "+
				"(2026, 7, '2026-10-20T12:00:00Z', 'commish_board_v9_ppr_12', '00-a', 1, null), "+
				"(2026, 7, '2026-10-20T12:00:00Z', 'commish_ros_shipped_ppr_12', '00-a', 9, null), "+
				"(2026, 7, '2026-10-22T18:00:00Z', 'commish_board_v9_ppr_12', '00-a', 1, null), "+
				"(2026, 7, '2026-10-22T18:00:00Z', 'commish_ros_shipped_ppr_12', '00-a', 1, 19.6), "+
				"(2026, 7, '2026-10-22T18:00:00Z', 'commish_ros_shipped_ppr_12', '00-b', 2, null), "+
				"(2026, 7, '2026-10-22T18:00:00Z', 'commish_ros_shipped_ppr_12', '00-c', 3, 4.0)",
			"insert into "+s+".register_grade_rows values "+
				"(2026, 7, '2026-10-22T18:00:00Z', '2026-10-28T22:00:00Z', 'commish_ros_shipped_ppr_12', '00-a')",
		)
	}
	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, s, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	return src
}

// Each week the register set the shipped order for, from its latest
// freeze, by ESPN id, with its grading time and the published projection
// it kept; a week whose freeze kept only the preseason board is none.
func TestSetOrdersReadsTheLatestFreezeOfTheShippedOrder(t *testing.T) {
	src := registerFixture(t, true)
	got, err := src.SetOrders(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Week != 7 {
		t.Fatalf("weeks %+v", got)
	}
	w := got[0]
	if !w.SetAt.Equal(time.Date(2026, 10, 22, 18, 0, 0, 0, time.UTC)) {
		t.Errorf("set at %v", w.SetAt)
	}
	if w.GradedAt == nil || !w.GradedAt.Equal(time.Date(2026, 10, 28, 22, 0, 0, 0, time.UTC)) {
		t.Errorf("graded at %v", w.GradedAt)
	}
	if len(w.Rank) != 2 || w.Rank["3116593"] != 1 || w.Rank["16733"] != 2 {
		t.Errorf("rank %v", w.Rank)
	}
	if len(w.Published) != 1 || w.Published["3116593"] != 19.6 {
		t.Errorf("published %v", w.Published)
	}
}

func TestSetOrdersWithNoRegisterTablesIsNone(t *testing.T) {
	got, err := registerFixture(t, false).SetOrders(context.Background(), 2026)
	if err != nil || got != nil {
		t.Fatalf("%v %v", got, err)
	}
}
