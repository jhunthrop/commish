package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

const facesSchema = "boards_faces_test"

// A player's face is our copy's address for the board's season when the
// ledger has a copied or curated row for him, and "" otherwise: a missing
// or failed row, another season's copy, no row at all, and every player
// while the ledger is absent (an api ahead of the migration). Never the
// provider's image, which the roster still carries.
func TestAFaceIsOurCopyOrNone(t *testing.T) {
	url := dbtest.URL(t)
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+facesSchema+" cascade")
		pool.Close()
	})
	s := facesSchema
	provider := "'https://a.espncdn.com/i/headshots/nfl/players/full/1.png'"
	for _, stmt := range []string{
		"drop schema if exists " + s + " cascade",
		"create schema " + s,
		"create table " + s + ".preseason_projections (season int, source text, player_id text, as_of timestamptz, " +
			"projected_points float8, floor_points float8, median_points float8, ceiling_points float8)",
		"create table " + s + ".player_crosswalk (provider_player_id text, player_id text)",
		"create table " + s + ".provider_players (id text, name text, position text, team text, headshot_url text, adp float8)",
		"create table " + s + ".provider_games (season int, week int, home_team text, away_team text)",
		"create table " + s + ".headshot_copies (season int, player_id text, status text)",
		"insert into " + s + ".preseason_projections values (2026, 'commish_board_v9_ppr_12', 'u1', '2026-09-01', 200, 150, 200, 250)",
		"insert into " + s + ".player_crosswalk values ('1', 'u1')",
		"insert into " + s + ".provider_players values " +
			"('1', 'Copied', 'WR', 'PHI', " + provider + ", 1), ('2', 'Curated', 'RB', 'PHI', null, 2), " +
			"('3', 'Missing', 'TE', 'PHI', " + provider + ", 3), ('4', 'Last Year', 'QB', 'PHI', " + provider + ", 4), " +
			"('5', 'No Row', 'WR', 'DAL', " + provider + ", 5)",
		"insert into " + s + ".provider_games values (2026, 1, 'PHI', 'DAL'), (2026, 2, 'NYG', 'DAL')",
		"insert into " + s + ".headshot_copies values (2026, '1', 'copied'), (2026, '2', 'curated'), " +
			"(2026, '3', 'missing'), (2025, '4', 'copied')",
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, s, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	faces := func(load func() (*Raw, error)) map[string]string {
		t.Helper()
		raw, err := load()
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, p := range raw.Players {
			out[p.ID] = p.Headshot
		}
		return out
	}
	board := func() (*Raw, error) { return src.Load(ctx, PPR) }
	scored := func() (*Raw, error) {
		return src.LoadScored(ctx, PPR, "custom", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), nil)
	}
	want := map[string]string{
		"1": "https://images.trycommish.app/headshots/2026/1/320.webp",
		"2": "https://images.trycommish.app/headshots/2026/2/320.webp",
		"3": "", "4": "", "5": "",
	}
	for name, load := range map[string]func() (*Raw, error){"board": board, "directory": scored} {
		got := faces(load)
		for id, face := range want {
			if got[id] != face {
				t.Errorf("%s: player %s face %q, want %q", name, id, got[id], face)
			}
		}
	}
	before, err := src.Version(ctx, PPR)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "insert into "+s+".headshot_copies values (2026, '5', 'copied')"); err != nil {
		t.Fatal(err)
	}
	if after, err := src.Version(ctx, PPR); err != nil || after == before {
		t.Fatalf("a new copy did not move the board's version (%v)", err)
	}
	if _, err := pool.Exec(ctx, "drop table "+s+".headshot_copies"); err != nil {
		t.Fatal(err)
	}
	for id, face := range faces(board) {
		if face != "" {
			t.Errorf("no ledger: player %s face %q, want none", id, face)
		}
	}
}
