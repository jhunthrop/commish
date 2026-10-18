package boards

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

func adpText(adp *float64) string {
	if adp == nil {
		return "none"
	}
	return strconv.FormatFloat(*adp, 'f', -1, 64)
}

// A player's ADP in the room is the board's (Lane 66o): every position reads
// the format's own capture taken before the first kickoff, the figure the
// site's board prints in its ADP column, never the provider's. A player the
// capture does not price has no ADP, as on the board, and the pool orders
// him after the priced ones by the provider's ADP.
func TestTheRoomsADPIsTheBoards(t *testing.T) {
	c := readMarketCase(t)
	src := marketFixture(t, c)
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var before, after string
	if err := json.Unmarshal(c.Captures["before_kickoff"], &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(c.Captures["after_kickoff"], &after); err != nil {
		t.Fatal(err)
	}
	// 'rb' (provider ADP 1.5) is priced by every capture; 'wr' (provider
	// ADP 2.0) by none.
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("insert into " + marketSchema + ".provider_players values ('wr', 'A Receiver', 'WR', 'LAR', null, 2.0)")
	exec("insert into " + marketSchema + ".player_crosswalk values ('wr', 'u-wr')")
	// A second capture row that cross-walks to 'rb' at a higher ADP: the one
	// rule on every reader (Lane 66o review M2) keeps the lower ADP, as the
	// nightly's place_capture does (research/tests/test_adp_capture.py).
	exec("insert into " + marketSchema + ".player_crosswalk values ('rb', 'u-rb-old')")
	const roomRB, lateRB, olderRB = 4.2, 9.0, 7.7
	for _, f := range Formats() {
		exec("insert into "+marketSchema+".adp_snapshots values ('u-rb-old', $1, $2::timestamptz, $3, $4)",
			adpSourceFor(f), before, string(f), olderRB)
		exec("insert into "+marketSchema+".adp_snapshots values ('u-rb', $1, $2::timestamptz, $3, $4)",
			adpSourceFor(f), before, string(f), roomRB)
		exec("insert into "+marketSchema+".adp_snapshots values ('u-rb', $1, $2::timestamptz, $3, $4)",
			adpSourceFor(f), after, string(f), lateRB)
	}

	for _, f := range Formats() {
		var caps formatCaptures
		if err := json.Unmarshal(c.Captures[string(f)], &caps); err != nil {
			t.Fatal(err)
		}
		board := map[string]float64{"rb": roomRB}
		for id, adp := range caps.BeforeKickoff {
			board[id] = adp
		}
		raw := load(t, src, f)
		place := map[string]int{}
		for i, p := range raw.Players {
			place[p.ID] = i
			want, priced := board[p.ID]
			switch {
			case priced && (p.ADP == nil || *p.ADP != want):
				t.Fatalf("%s: %s's ADP in the room %s, the board's %v", f, p.ID, adpText(p.ADP), want)
			case !priced && p.ADP != nil:
				t.Fatalf("%s: %s has ADP %v in the room, the board prices him at none", f, p.ID, *p.ADP)
			}
		}
		for id := range board {
			if place[id] > place["wr"] {
				t.Fatalf("%s: unpriced wr at %d ahead of priced %s at %d", f, place["wr"], id, place[id])
			}
		}
		for _, p := range raw.Players {
			if _, priced := board[p.ID]; !priced && (p.Position == "K" || p.Position == "DEF") && place[p.ID] < place["wr"] {
				t.Fatalf("%s: unpriced %s %s ahead of unpriced wr", f, p.Position, p.ID)
			}
		}
	}
}
