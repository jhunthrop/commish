package boards

import (
	"context"
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// marketSchema is a scratch schema shaped like the research tables the
// board reads, adp_snapshots included, dropped when the test ends.
const marketSchema = "boards_market_test"

// marketCase is api/testdata/market-order.json, the order the nightly's
// tests hold the site's board to (research/tests/test_market_rows.py).
type marketCase struct {
	Season       int `json:"season"`
	FirstKickoff struct {
		GameDate  string `json:"game_date"`
		KickoffET string `json:"kickoff_et"`
	} `json:"first_kickoff"`
	Players []struct {
		ID          string  `json:"id"`
		Position    string  `json:"position"`
		Team        string  `json:"team"`
		ProviderADP float64 `json:"provider_adp"`
	} `json:"players"`
	Captures map[string]json.RawMessage   `json:"captures"`
	First    map[string]map[string]string `json:"first"`
	Order    map[string][]string          `json:"order"`
}

type formatCaptures struct {
	BeforeKickoff map[string]float64 `json:"before_kickoff"`
	AfterKickoff  map[string]float64 `json:"after_kickoff"`
}

func readMarketCase(t *testing.T) marketCase {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/market-order.json")
	if err != nil {
		t.Fatal(err)
	}
	var c marketCase
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func marketFixture(t *testing.T, c marketCase) *PGSource {
	t.Helper()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+marketSchema+" cascade")
		pool.Close()
	})
	s := marketSchema
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("drop schema if exists " + s + " cascade")
	exec("create schema " + s)
	exec("create table " + s + ".preseason_projections (season int, source text, player_id text, as_of timestamptz, " +
		"projected_points float8, floor_points float8, median_points float8, ceiling_points float8)")
	exec("create table " + s + ".player_crosswalk (provider_player_id text, player_id text)")
	exec("create table " + s + ".provider_players (id text, name text, position text, team text, headshot_url text, adp float8)")
	exec("create table " + s + ".provider_games (season int, week int, home_team text, away_team text, game_date date, kickoff_et text)")
	exec("create table " + s + ".adp_snapshots (player_id text, source text, captured_at timestamptz, format text, adp float8)")
	exec("insert into "+s+".provider_games values ($1, 1, 'DAL', 'PHI', $2::date, $3)",
		c.Season, c.FirstKickoff.GameDate, c.FirstKickoff.KickoffET)
	for _, f := range Formats() {
		exec("insert into "+s+".preseason_projections values ($1, $2, 'u-rb', '2026-09-09T02:20:29Z', 200, 150, 200, 250)",
			c.Season, "commish_board_v9_"+string(f)+"_12")
	}
	exec("insert into " + s + ".provider_players values ('rb', 'A Back', 'RB', 'DET', null, 1.5)")
	exec("insert into " + s + ".player_crosswalk values ('rb', 'u-rb')")
	for _, p := range c.Players {
		exec("insert into "+s+".provider_players values ($1, $1, $2, $3, null, $4)", p.ID, p.Position, p.Team, p.ProviderADP)
		exec("insert into "+s+".player_crosswalk values ($1, $2)", p.ID, "u-"+p.ID)
	}
	at := map[string]string{}
	for _, key := range []string{"before_kickoff", "after_kickoff"} {
		var stamp string
		if err := json.Unmarshal(c.Captures[key], &stamp); err != nil {
			t.Fatal(err)
		}
		at[key] = stamp
	}
	for _, f := range Formats() {
		var caps formatCaptures
		if err := json.Unmarshal(c.Captures[string(f)], &caps); err != nil {
			t.Fatal(err)
		}
		for key, prices := range map[string]map[string]float64{"before_kickoff": caps.BeforeKickoff, "after_kickoff": caps.AfterKickoff} {
			for id, adp := range prices {
				exec("insert into "+s+".adp_snapshots values ($1, $2, $3::timestamptz, $4, $5)",
					"u-"+id, adpSourceFor(f), at[key], string(f), adp)
			}
		}
	}
	src, err := NewPGSource(pool, s, c.Season, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	return src
}

// The room's board orders kickers and defenses as the site's board does,
// from the same per-format capture taken before the first kickoff: its
// first kicker and first defense (position rank 1 in the room) are the
// board's for every format, the drafted ones in the board's order and the
// undrafted after them by id; the provider's ADP and the capture after the
// kickoff move nothing. The basis says draft order.
func TestTheRoomOrdersKickersAndDefensesAsTheBoardDoes(t *testing.T) {
	c := readMarketCase(t)
	src := marketFixture(t, c)
	for _, f := range Formats() {
		raw := load(t, src, f)
		b, err := For(raw, 12, draft.StandardRosterSlots())
		if err != nil {
			t.Fatal(err)
		}
		first := map[string]string{}
		var market []string
		for _, p := range raw.Players {
			position := string(p.Position)
			if position != "K" && position != "DEF" {
				continue
			}
			market = append(market, p.ID)
			if b.PositionRanks[p.ID] == 1 {
				first[position] = p.ID
			}
		}
		if first["K"] != c.First[string(f)]["K"] || first["DEF"] != c.First[string(f)]["DEF"] {
			t.Fatalf("%s: the room's first kicker and defense %v, the board's %v", f, first, c.First[string(f)])
		}
		want := c.Order[string(f)]
		if strings.Join(market[:len(want)], " ") != strings.Join(want, " ") {
			t.Fatalf("%s: the room's draft order %v, the board's %v", f, market, want)
		}
		if rest := market[len(want):]; !sort.StringsAreSorted(rest) {
			t.Fatalf("%s: the undrafted %v are not by id", f, rest)
		}
		if !strings.Contains(b.Basis(), "Kickers and defenses carry no projection and rank in draft order.") {
			t.Fatalf("%s: basis %q", f, b.Basis())
		}
	}
}
