package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// projectionSchema builds the two tables the read joins: three snapshots of
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
		`insert into ` + schema + `.provider_players values ('4431611')`,
		`create table ` + schema + `.tank01_projection_rows (snapshot_id bigint, provider_player_id text, captured_at timestamptz,
			season int, week int, position text, team text, ppr_points float8, half_points float8, standard_points float8)`,
		`insert into ` + schema + `.tank01_projection_rows values
			(9, '4431611', '2026-10-14 13:00:00+00', 2026, 6, 'QB', 'CHI', 17.0, 17.0, 17.0),
			(10, '4431611', '2026-10-15 13:00:00+00', 2026, 6, 'QB', 'CHI', 18.0, 18.0, 18.0),
			(11, '4431611', '2026-10-17 01:00:00+00', 2026, 6, 'QB', 'CHI', 19.44, 19.44, 19.44),
			(11, '2971573', '2026-10-17 01:00:00+00', 2026, 6, 'PK', 'HOU', 8.1, 8.1, 8.1),
			(11, '9999999', '2026-10-17 01:00:00+00', 2026, 6, 'FB', 'SF', 2.1, 1.6, 1.1),
			(11, '3000001', '2026-10-17 01:00:00+00', 2026, 6, 'PK', 'DAL', 9.0, 9.0, 9.0),
			(11, '3000002', '2026-10-17 01:00:00+00', 2026, 6, 'PK', 'DAL', 1.0, 1.0, 1.0),
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
// universe is left out, a kicker is kept whether or not the universe
// holds him and named by his club when it has one, a defense is keyed by
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
	if len(p.Players) != 4 || p.Players["4431611"].PPR != 19.44 || p.Players["2971573"].PPR != 8.1 {
		t.Fatalf("players %+v: the newest snapshot's, the fullback outside the universe left out", p.Players)
	}
	if k, ok := p.Player("", "K", "HOU"); !ok || k.PPR != 8.1 {
		t.Fatalf("Houston's kicker by his club: %+v %v", k, ok)
	}
	if k, ok := p.Player("2971573", "K", "HOU"); !ok || k.PPR != 8.1 {
		t.Fatalf("Houston's kicker by his id: %+v %v", k, ok)
	}
	if _, ok := p.Player("", "K", "DAL"); ok {
		t.Fatal("a club with two kickers names neither by club")
	}
	// A kicker with a board id the snapshot left out has no row: never his
	// club's kicker's (review L1).
	if k, ok := p.Player("9999998", "K", "HOU"); ok {
		t.Fatalf("a kicker the snapshot left out took his club's %+v", k)
	}
	if d, ok := p.Player("", "DEF", "WSH"); !ok || d.Standard != 6 {
		t.Fatalf("the Washington defense %+v %v", d, ok)
	}
	if _, ok := p.Player("", "WR", "CHI"); ok {
		t.Fatal("a player with no board id has no row")
	}
	// The snapshot before is read with it (Lane 66e): the change since it,
	// none for a player it lacks.
	if p.Previous == nil || !p.Previous.ReadAt.Equal(time.Date(2026, 10, 15, 13, 0, 0, 0, time.UTC)) {
		t.Fatalf("the snapshot before: %+v", p.Previous)
	}
	// From the printed tenths: 19.4 against 18.0 (review L11).
	if d, ok := p.Delta("4431611", "QB", "CHI", apitypes.ScoringPresetPpr); !ok || d < 1.399 || d > 1.401 {
		t.Fatalf("Williams's change since the read before: %v %v", d, ok)
	}
	if _, ok := p.Delta("2971573", "K", "HOU", apitypes.ScoringPresetPpr); ok {
		t.Fatal("a kicker the snapshot before lacks has no change")
	}
	// Every earlier snapshot is read too, newest first, each with its own
	// before (Lane 92): a game past its kickoff reads the one as of kickoff.
	if len(p.Earlier) != 2 || p.Earlier[0].ReadAt != p.Previous.ReadAt || p.Earlier[1].Players["4431611"].PPR != 17 {
		t.Fatalf("the earlier snapshots %+v", p.Earlier)
	}
	kickoff := p.AsOf(time.Date(2026, 10, 16, 17, 0, 0, 0, time.UTC))
	if kickoff.Players["4431611"].PPR != 18 || kickoff.Previous == nil || kickoff.Previous.Players["4431611"].PPR != 17 {
		t.Fatalf("as of a kickoff between the two older snapshots: %+v", kickoff)
	}
	if d, ok := kickoff.Delta("4431611", "QB", "CHI", apitypes.ScoringPresetPpr); !ok || d != 1 {
		t.Fatalf("the change as of kickoff %v %v, want 1.0 since the snapshot before it", d, ok)
	}
	only, err := src.WeekProjection(context.Background(), 2026, 7)
	if err != nil || only.Previous != nil || only.Players["4431611"].PPR != 25 {
		t.Fatalf("a week with one snapshot has none before: %+v %v", only, err)
	}
	if _, ok := only.Delta("4431611", "QB", "CHI", apitypes.ScoringPresetPpr); ok {
		t.Fatal("no change without a snapshot before")
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

// AsOf is the newest snapshot at or before the instant (Lane 92, B27), the
// newest itself when it was captured by then, the earliest held when every
// one came after.
func TestWeekProjectionAsOfAKickoff(t *testing.T) {
	at := func(day int) time.Time { return time.Date(2026, 10, day, 12, 0, 0, 0, time.UTC) }
	snap := func(day int, ppr float64) WeekProjection {
		w := emptyProjection(6)
		w.ReadAt = at(day)
		w.Players["p"] = ProjectedPoints{PPR: ppr}
		return w
	}
	w := chained([]WeekProjection{snap(18, 3), snap(16, 2), snap(14, 1)}, []map[string]int{{}, {}, {}})
	for _, c := range []struct {
		name string
		at   time.Time
		want float64
	}{
		{"after the newest", at(19), 3},
		{"at the newest", at(18), 3},
		{"between", at(17), 2},
		{"at the earliest", at(14), 1},
		{"before every snapshot", at(13), 1},
	} {
		if got := w.AsOf(c.at).Players["p"].PPR; got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
	if prev := w.AsOf(at(17)).Previous; prev == nil || prev.Players["p"].PPR != 1 {
		t.Errorf("the snapshot before the one as of kickoff: %+v", prev)
	}
	if one := snap(18, 3); one.AsOf(at(13)).Players["p"].PPR != 3 {
		t.Error("a week of one snapshot reads it at any instant")
	}
}
