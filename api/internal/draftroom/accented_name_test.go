package draftroom

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// accentSchema is a scratch schema shaped like the research tables the
// directory reads, dropped when the test ends.
const accentSchema = "draftroom_accent_test"

// estime is the provider row as the research crosswalk now spells it
// (Lane 78): nflverse's "Audric Estimé", the accent the provider dropped.
const (
	estimeID   = "4569682"
	estimeGSIS = "00-0039373"
	estimeName = "Audric Estimé"
)

func accentSource(t *testing.T) *boards.PGSource {
	t.Helper()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+accentSchema+" cascade")
		pool.Close()
	})
	s := accentSchema
	for _, sql := range []string{
		"drop schema if exists " + s + " cascade",
		"create schema " + s,
		"create table " + s + ".provider_players (id text, name text, position text, team text, headshot_url text, adp float8)",
		"create table " + s + ".player_crosswalk (provider_player_id text, player_id text)",
		"create table " + s + ".provider_games (season int, week int, home_team text, away_team text)",
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, "insert into "+s+".provider_players values ($1, $2, 'RB', 'DEN', null, 120.5)",
		estimeID, estimeName); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "insert into "+s+".player_crosswalk values ($1, $2)", estimeID, estimeGSIS); err != nil {
		t.Fatal(err)
	}
	src, err := boards.NewPGSource(pool, s, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	return src
}

// The name field carries a player's name as he spells it, accent and all,
// from the stored row to the wire (Lane 78).
func TestTheNameFieldKeepsHisAccent(t *testing.T) {
	src := accentSource(t)
	points := map[string]boards.Projection{estimeGSIS: {Points: 150, Floor: 100, Median: 150, Ceiling: 200}}
	asOf := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	raw, err := src.LoadScored(context.Background(), boards.PPR, "lane78", asOf, points)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw.Players) != 1 || raw.Players[0].Name != estimeName {
		t.Fatalf("the directory read %+v, want one player named %q", raw.Players, estimeName)
	}
	slots, err := mock.SlotConfig(reportSettings(t).League)
	if err != nil {
		t.Fatal(err)
	}
	b, err := boards.For(raw, 12, slots)
	if err != nil {
		t.Fatal(err)
	}
	view := BoardView(b, nil)
	if len(view.Players) != 1 || view.Players[0].Name != estimeName {
		t.Fatalf("the wire board %+v, want %q", view.Players, estimeName)
	}
	wire, err := json.Marshal(view.Players[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(wire), `"name":"`+estimeName+`"`) {
		t.Fatalf("the name field reads %s, want %q", wire, estimeName)
	}
}
