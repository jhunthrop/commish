package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// projectionSchema builds the two tables the read joins: two snapshots of
// week 6 and one of week 7, a fullback outside our universe, a kicker as
// the provider files him ("PK") and a defense by its club in the
// provider's spelling.
func projectionSchema(t *testing.T, pool *pgxpool.Pool, schema string) {
	t.Helper()
	ctx := context.Background()
	qs := []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.provider_players (id text primary key)`,
		`insert into ` + schema + `.provider_players values ('4431611'), ('2971573')`,
		`create table ` + schema + `.tank01_projection_rows (snapshot_id bigint, provider_player_id text, captured_at timestamptz,
			season int, week int, position text, team text, ppr_points float8, half_points float8, standard_points float8)`,
		`insert into ` + schema + `.tank01_projection_rows values
			(10, '4431611', '2026-10-15 13:00:00+00', 2026, 6, 'QB', 'CHI', 18.0, 18.0, 18.0),
			(11, '4431611', '2026-10-17 01:00:00+00', 2026, 6, 'QB', 'CHI', 19.44, 19.44, 19.44),
			(11, '2971573', '2026-10-17 01:00:00+00', 2026, 6, 'PK', 'HOU', 8.1, 8.1, 8.1),
			(11, '9999999', '2026-10-17 01:00:00+00', 2026, 6, 'FB', 'SF', 2.1, 1.6, 1.1),
			(11, 'DEF-WAS', '2026-10-17 01:00:00+00', 2026, 6, 'DEF', 'WAS', 6.0, 6.0, 6.0),
			(12, '4431611', '2026-10-21 01:00:00+00', 2026, 7, 'QB', 'CHI', 25.0, 25.0, 25.0)`,
	}
	for _, q := range qs {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
}

// The week's read is its newest snapshot alone: a player outside our
// universe is left out, a kicker is kept as filed, a defense is keyed by
// its club in the board's codes.
func TestWeekProjectionReadsTheNewestSnapshot(t *testing.T) {
	pool := dbtest.Pool(t)
	const schema = "projections_test"
	projectionSchema(t, pool, schema)
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := src.WeekProjection(context.Background(), 2026, 6)
	if err != nil {
		t.Fatal(err)
	}
	if !p.ReadAt.Equal(time.Date(2026, 10, 17, 1, 0, 0, 0, time.UTC)) || p.Week != 6 {
		t.Fatalf("read at %v week %d: the newest snapshot", p.ReadAt, p.Week)
	}
	if len(p.Players) != 2 || p.Players["4431611"].PPR != 19.44 || p.Players["2971573"].PPR != 8.1 {
		t.Fatalf("players %+v: the newest snapshot's, the fullback outside the universe left out", p.Players)
	}
	if d, ok := p.Player("", "DEF", "WSH"); !ok || d.Standard != 6 {
		t.Fatalf("the Washington defense %+v %v", d, ok)
	}
	if _, ok := p.Player("", "WR", "CHI"); ok {
		t.Fatal("a player with no board id has no row")
	}
	none, err := src.WeekProjection(context.Background(), 2026, 9)
	if err != nil || !none.ReadAt.IsZero() || len(none.Players) != 0 {
		t.Fatalf("a week with no snapshot: %+v %v", none, err)
	}
}

// Without the table the read answers empty, as the venues do.
func TestWeekProjectionWithoutTheTableIsEmpty(t *testing.T) {
	pool := dbtest.Pool(t)
	const schema = "projections_none_test"
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `drop schema if exists `+schema+` cascade; create schema `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := src.WeekProjection(ctx, 2026, 6)
	if err != nil || !p.ReadAt.IsZero() || len(p.Players) != 0 || len(p.Defenses) != 0 {
		t.Fatalf("%+v %v", p, err)
	}
}

func TestProjectedPointsForEachPreset(t *testing.T) {
	p := ProjectedPoints{PPR: 15, Half: 12.5, Standard: 10}
	cases := map[apitypes.ScoringPreset]float64{
		apitypes.ScoringPresetPpr: 15, apitypes.ScoringPresetTePremium: 15,
		apitypes.ScoringPresetHalfPpr: 12.5, apitypes.ScoringPresetStandard: 10,
	}
	for preset, want := range cases {
		if got := p.For(preset); got != want {
			t.Errorf("%s: %v", preset, got)
		}
	}
}
