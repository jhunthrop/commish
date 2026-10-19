package boards

import (
	"context"
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The one final-held rule (Lane 80) is the research store's view,
// club_week_finals; these are its definition and its shared fixture, which
// research/tests/test_club_week_finals.py holds the Python reads to.
const (
	finalsViewSQL     = "../../../research/db/schema/club_week_finals.sql"
	finalsFixtureJSON = "../../../research/db/schema/club_week_finals_fixture.json"
)

// createFinalsView builds the view in a test schema from its one definition.
func createFinalsView(t *testing.T, pool *pgxpool.Pool, schema string) {
	t.Helper()
	ddl, err := os.ReadFile(finalsViewSQL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), strings.ReplaceAll(string(ddl), "{schema}", schema)); err != nil {
		t.Fatal(err)
	}
}

type finalsFixture struct {
	Observations []struct {
		Season int     `json:"season"`
		Week   int     `json:"week"`
		Team   string  `json:"team"`
		Source string  `json:"source"`
		Metric string  `json:"metric"`
		Value  float64 `json:"value"`
		AsOf   string  `json:"as_of"`
	} `json:"observations"`
	Teams []struct {
		Season   int    `json:"season"`
		Week     int    `json:"week"`
		PlayerID string `json:"player_id"`
		Team     string `json:"team"`
		AsOf     string `json:"as_of"`
	} `json:"teams"`
	Finals []struct {
		Season int    `json:"season"`
		Week   int    `json:"week"`
		Team   string `json:"team"`
	} `json:"finals"`
}

// The API's week facts read exactly the shared fixture's finals from the
// view: the result, the hourly status's final and a line with the club,
// and never a live status, another source's result, or a kickoff.
func TestFinalsAreTheViewsSharedFixture(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "finals_test"
	raw, err := os.ReadFile(finalsFixtureJSON)
	if err != nil {
		t.Fatal(err)
	}
	var f finalsFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.team_week_observations (season int, week int, team text, source text, metric text, as_of timestamptz, value float8)`,
		`create table ` + schema + `.player_week_teams (season int, week int, player_id text, team text, as_of timestamptz)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	createFinalsView(t, pool, schema)
	for _, o := range f.Observations {
		if _, err := pool.Exec(ctx, `insert into `+schema+`.team_week_observations values ($1, $2, $3, $4, $5, $6, $7)`,
			o.Season, o.Week, o.Team, o.Source, o.Metric, o.AsOf, o.Value); err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range f.Teams {
		if _, err := pool.Exec(ctx, `insert into `+schema+`.player_week_teams values ($1, $2, $3, $4, $5)`,
			r.Season, r.Week, r.PlayerID, r.Team, r.AsOf); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	_, finals, err := src.teamWeekFacts(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	var got, want []string
	for key := range finals {
		got = append(got, key)
	}
	for _, r := range f.Finals {
		want = append(want, teamWeekKey(r.Week, ProductTeam(r.Team)))
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("finals %v, the shared fixture's %v", got, want)
	}
}
