package inseason

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// stashNow is the Wednesday the stash fixture reads at: week 7 to come.
var stashNow = time.Date(2026, 10, 21, 12, 0, 0, 0, east)

// stashFixture is the rest-of-season fixture at week 7 with a playoff
// from week 15, and five of its free agents named: back in week 9 from
// injured reserve, back in week 8 from an out, on injured reserve with no
// date, back in week 16 (the playoffs), and questionable. The baseline
// page's first rows are the five, in that order.
func stashFixture(t *testing.T) (fixture, []string) {
	t.Helper()
	f := restFixture(t)
	f.league.Snap.Terms.PlayoffFirst, f.league.Snap.Terms.PlayoffLast = 15, 17
	before := pickupPage(t, f, stashNow, "")
	if len(before.Rows) < 5 {
		t.Fatalf("%d rows", len(before.Rows))
	}
	ids := make([]string, 5)
	for i := range ids {
		ids[i] = *before.Rows[i].Add.Player.BoardId
	}
	stamp := stashNow.Add(-6 * time.Hour)
	// Week 8's last game is Sunday Nov 1, week 15's Dec 20.
	f.data.Designations = map[string]boards.Designation{
		ids[0]: {Code: "IR", AsOf: stamp, ReturnOn: eastDay(time.November, 3)},
		ids[1]: {Code: "O", AsOf: stamp, ReturnOn: eastDay(time.October, 27)},
		ids[2]: {Code: "IR", AsOf: stamp},
		ids[3]: {Code: "IR", AsOf: stamp, ReturnOn: eastDay(time.December, 22)},
		ids[4]: {Code: "Q", AsOf: stamp},
	}
	return f, ids
}

func rowOf(rows []apitypes.WaiverRow, id string) (apitypes.WaiverRow, bool) {
	for _, r := range rows {
		if *r.Add.Player.BoardId == id {
			return r, true
		}
	}
	return apitypes.WaiverRow{}, false
}

// The Stash group (Lane 118, B79), through the engine on a fixed clock:
// the injured reserve and out free agents due back inside the regular
// season, each with his week and his rate from it, by that rate; never in
// the rows or the strip; the undated one counted, the one back in the
// playoffs left out; a questionable one stays in the rows.
func TestTheStashGroupHoldsWhoComesBackInTheRegularSeason(t *testing.T) {
	f, ids := stashFixture(t)
	page := pickupPage(t, f, stashNow, "")
	if page.Stash == nil || len(*page.Stash) != 2 {
		t.Fatalf("stash %v, want the two due back in the regular season", page.Stash)
	}
	stash := *page.Stash
	weeks := map[string]int{ids[0]: 9, ids[1]: 8}
	games := map[string]float64{ids[0]: 9, ids[1]: 10}
	for _, r := range stash {
		id := *r.Add.Player.BoardId
		if r.Stash == nil || r.Stash.BackWeek != weeks[id] {
			t.Fatalf("%s stash %+v, want back week %d", id, r.Stash, weeks[id])
		}
		bp, _ := f.league.Board.Player(id)
		want := roundTenth(*bp.Points / games[id])
		if r.Stash.PerGame == nil || *r.Stash.PerGame != want {
			t.Errorf("%s rate %v, want %.1f over his club's games from week %d", id, r.Stash.PerGame, want, weeks[id])
		}
		if r.WeekGain != nil || r.Pickup || r.Starts {
			t.Errorf("%s carries a week figure: %+v", id, r)
		}
		if r.Stash.IrSlot || r.Drop == nil {
			t.Errorf("%s: a Sleeper league with no IR slot read says Add with a drop, got slot %v drop %v", id, r.Stash.IrSlot, r.Drop)
		}
	}
	if !ratedAbove(stash[0].Stash.PerGame, stash[1].Stash.PerGame) && *stash[0].Stash.PerGame != *stash[1].Stash.PerGame {
		t.Errorf("stash out of order: %v then %v", *stash[0].Stash.PerGame, *stash[1].Stash.PerGame)
	}
	for _, id := range ids[:4] {
		if _, listed := rowOf(page.Rows, id); listed {
			t.Errorf("%s is listed in the rows", id)
		}
		if _, offered := rowOf(page.Pickups, id); offered {
			t.Errorf("%s is offered on the strip", id)
		}
	}
	if _, listed := rowOf(page.Rows, ids[4]); !listed {
		t.Error("the questionable free agent left the rows")
	}
	if _, in := rowOf(stash, ids[3]); in {
		t.Error("the player back in the playoffs is in the stash")
	}
	if page.StashUndated == nil || *page.StashUndated != 1 {
		t.Errorf("undated %v, want the one injured reserve with no date", page.StashUndated)
	}
	// The player a link asked for keeps his row in the table, out of the stash.
	asked := pickupPageFor(t, f, stashNow, "", ids[0])
	if _, listed := rowOf(asked.Rows, ids[0]); !listed {
		t.Error("the asked player is not in the table")
	}
	if _, in := rowOf(*asked.Stash, ids[0]); in {
		t.Error("the asked player is in the stash too")
	}
}

// The verb's rule (B79): an open injured reserve slot from the league's
// settings that takes him is Stash with no drop; an out player takes one
// only where the platform's slot takes an out; a filled slot is Add.
func TestAStashTakesAnOpenIRSlotThatTakesHim(t *testing.T) {
	f, ids := stashFixture(t)
	f.league.Snap.Shape.IR = 1
	stash := *pickupPage(t, f, stashNow, "").Stash
	ir, _ := rowOf(stash, ids[0])
	out, _ := rowOf(stash, ids[1])
	if !ir.Stash.IrSlot || ir.Drop != nil || len(ir.Drops) != 0 || ir.Beats != nil {
		t.Errorf("the injured reserve player with a slot open: slot %v drop %v drops %d", ir.Stash.IrSlot, ir.Drop, len(ir.Drops))
	}
	if out.Stash.IrSlot || out.Drop == nil {
		t.Errorf("the out player where the slot takes no out: slot %v drop %v", out.Stash.IrSlot, out.Drop)
	}
	f.league.Snap.Shape.IROut = true
	stash = *pickupPage(t, f, stashNow, "").Stash
	if out, _ := rowOf(stash, ids[1]); !out.Stash.IrSlot {
		t.Error("the out player where the slot takes an out is no Stash")
	}
	for i := range f.league.Snap.Teams {
		if f.league.Snap.Teams[i].RosterID == f.league.Me {
			f.league.Snap.Teams[i].Reserve = []string{"h999"}
		}
	}
	for _, r := range *pickupPage(t, f, stashNow, "").Stash {
		if r.Stash.IrSlot {
			t.Errorf("%s: a filled slot is still Stash", r.Add.Player.Name)
		}
	}
}

// A free agent the Stash group could hold (lane 98's not-listed rule) and
// the listed rule beside it: an out whose dating is pending stays listed
// (Lane 118, B94), as a questionable or carried-over one does.
func TestListedAddKeepsACarriedOverOrPendingOut(t *testing.T) {
	cases := []struct {
		name string
		d    *Designation
		want bool
	}{
		{"no designation", nil, true},
		{"questionable", &Designation{Status: boards.StatusQuestionable}, true},
		{"out this week", &Designation{Status: boards.StatusOut}, false},
		{"out, carried over", &Designation{Status: boards.StatusOut, CarriedOver: true}, true},
		{"out, dating pending", &Designation{Status: boards.StatusOut, Pending: true}, true},
		{"injured reserve", &Designation{Status: boards.StatusInjuredReserve}, false},
		{"injured reserve, dating pending", &Designation{Status: boards.StatusInjuredReserve, Pending: true}, false},
		{"physically unable", &Designation{Status: boards.StatusPUP}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := person{words: Line{Facts: Facts{Designation: tc.d}}}
			if got := listedAdd(p); got != tc.want {
				t.Fatalf("listed %v, want %v", got, tc.want)
			}
		})
	}
}

// Through the engine on Monday night's turned page (Lane 118, B94): a free
// agent whose out is pending a dating stays in the add list, and on the
// wire his designation carries neither listed nor carried_over (absent,
// not false), so both webs draw the word alone.
func TestAPendingOutStaysListedWithNoDatingOnTheWire(t *testing.T) {
	s, f := turnService(t, mondayNight, false)
	before := decode[apitypes.WaiverAdvice](t, s, "waivers")
	if len(before.Rows) == 0 {
		t.Fatal("no rows")
	}
	id := *before.Rows[0].Add.Player.BoardId
	data := f.data
	data = everyGameFinal(data)
	data = withWeekSeven(data)
	data.Designations = map[string]boards.Designation{
		id: {Code: "O", AsOf: mondayNight.Add(-time.Hour), DatingPending: true},
	}
	s.Facts = weekFacts{data: data, byWeek: map[int]boards.WeekProjection{6: everyoneProjected(f)}}
	code, env := serve(t, s, leaguePath+"waivers")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("waivers: %d %+v", code, env.Error)
	}
	var raw struct {
		Rows []struct {
			Add struct {
				Player struct {
					BoardID *string `json:"board_id"`
				} `json:"player"`
				Facts struct {
					Designation map[string]json.RawMessage `json:"designation"`
				} `json:"facts"`
			} `json:"add"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(env.Data, &raw); err != nil {
		t.Fatal(err)
	}
	for _, r := range raw.Rows {
		if r.Add.Player.BoardID == nil || *r.Add.Player.BoardID != id {
			continue
		}
		d := r.Add.Facts.Designation
		if string(d["status"]) != `"out"` {
			t.Fatalf("designation %v, want out", d)
		}
		for _, key := range []string{"listed", "carried_over"} {
			if v, sent := d[key]; sent {
				t.Errorf("%s is sent as %s, want it absent", key, v)
			}
		}
		return
	}
	t.Fatal("the pending out left the add list")
}
