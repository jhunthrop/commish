package boards

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// versioned is a Source whose version the test moves, counting loads.
type versioned struct {
	version string
	err     error
	loads   int
}

func (v *versioned) Load(context.Context, Format) (*Raw, error) {
	v.loads++
	return &Raw{Format: PPR, Source: v.version}, nil
}

func (v *versioned) Version(context.Context, Format) (string, error) { return v.version, v.err }

// Each read that goes to the store logs its kind and duration (Lane 112
// review LOW-2): the first a full load, one past the TTL with the version
// unmoved a version check, one inside the TTL nothing.
func TestCacheLogsEachStoreRead(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	var logged bytes.Buffer
	cache := &Cache{Source: &versioned{version: "a"}, TTL: time.Minute, Now: func() time.Time { return now },
		Log: slog.New(slog.NewTextHandler(&logged, nil))}
	for _, advance := range []time.Duration{0, 30 * time.Second, 2 * time.Minute} {
		now = now.Add(advance)
		if _, err := cache.Load(context.Background(), PPR); err != nil {
			t.Fatal(err)
		}
	}
	out := logged.String()
	if strings.Count(out, `msg="boards: board read"`) != 2 || !strings.Contains(out, "kind=load") || !strings.Contains(out, "kind=version") {
		t.Fatalf("board read lines:\n%s", out)
	}
}

// Past its TTL the cache keeps a board whose version stands, and reads it
// again once the version moves or cannot be read.
func TestCacheKeepsAnUnmovedBoardPastItsTTL(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	src := &versioned{version: "a"}
	cache := &Cache{Source: src, TTL: time.Minute, Now: func() time.Time { return now }}
	steps := []struct {
		advance time.Duration
		version string
		err     error
		loads   int
	}{
		{0, "a", nil, 1},                           // first read
		{30 * time.Second, "a", nil, 1},            // inside the TTL
		{2 * time.Minute, "a", nil, 1},             // past it, unmoved: kept
		{30 * time.Second, "a", nil, 1},            // the kept board's TTL restarted
		{2 * time.Minute, "b", nil, 2},             // moved: read again
		{2 * time.Minute, "b", errors.New("x"), 3}, // no version: read in full
	}
	for i, s := range steps {
		now = now.Add(s.advance)
		src.version, src.err = s.version, s.err
		raw, err := cache.Load(ctx, PPR)
		if err != nil {
			t.Fatal(err)
		}
		if src.loads != s.loads {
			t.Fatalf("step %d: %d loads, want %d", i, src.loads, s.loads)
		}
		if raw.Source != s.version {
			t.Fatalf("step %d: board of version %q, want %q", i, raw.Source, s.version)
		}
	}
}

const versionSchema = "boards_version_test"

// The version is equal while the rows Load reads are, and moves with any
// of them: a player's ADP, the stored board's points, a bye.
func TestPGSourceVersionMovesWithTheRowsLoadReads(t *testing.T) {
	url := dbtest.URL(t)
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+versionSchema+" cascade")
		pool.Close()
	})
	s := versionSchema
	for _, stmt := range []string{
		"drop schema if exists " + s + " cascade",
		"create schema " + s,
		"create table " + s + ".preseason_projections (season int, source text, player_id text, as_of timestamptz, " +
			"projected_points float8, floor_points float8, median_points float8, ceiling_points float8)",
		"create table " + s + ".player_crosswalk (provider_player_id text, player_id text)",
		"create table " + s + ".provider_players (id text, name text, position text, team text, headshot_url text, adp float8)",
		"create table " + s + ".provider_games (season int, week int, home_team text, away_team text)",
		"insert into " + s + ".preseason_projections values (2026, 'commish_board_v9_ppr_12', 'u1', '2026-09-01', 200, 150, 200, 250)",
		"insert into " + s + ".player_crosswalk values ('p1', 'u1')",
		"insert into " + s + ".provider_players values ('p1', 'A. Player', 'WR', 'PHI', null, 12.5)",
		"insert into " + s + ".provider_games values (2026, 1, 'PHI', 'DAL'), (2026, 2, 'NYG', 'DAL')",
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, s, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	version := func() string {
		t.Helper()
		v, err := src.Version(ctx, PPR)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	first := version()
	if again := version(); again != first {
		t.Fatalf("unmoved rows, two versions: %s, %s", first, again)
	}
	seen := map[string]bool{first: true}
	for _, change := range []string{
		"update " + s + ".provider_players set adp = 13",
		"update " + s + ".preseason_projections set projected_points = 201",
		"insert into " + s + ".provider_games values (2026, 3, 'PHI', 'NYG')",
	} {
		if _, err := pool.Exec(ctx, change); err != nil {
			t.Fatal(err)
		}
		v := version()
		if seen[v] {
			t.Fatalf("%s: the version did not move", change)
		}
		seen[v] = true
	}
}
