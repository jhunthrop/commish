package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Beats for a row the strip does not offer (Lane 98, B14, review H1):
// the starter the add takes out of the rest-of-season lineup the Gain is
// measured on, from the same fill; the drop himself when he started and
// no one else leaves; nobody when the add does not start.
func TestBeatsNamesWhomTheMoveTakesOutOfTheSeasonLineup(t *testing.T) {
	squad := Squad{Players: pprRoster(), Held: map[string]bool{}}
	cases := []struct {
		name string
		add  Candidate
		want string
	}{
		// rb2 (50) moves to the flex, rb3 (25) leaves.
		{"a back over the flex back", player("fa", draft.RB, 10, 60), "rb3"},
		// wr3 (30) moves to the flex, rb3 leaves: never the third receiver.
		{"a receiver tops the flex back, not the third receiver", player("fw", draft.WR, 10, 40), "rb3"},
		{"a defense with points over the starter's", player("fd", draft.DEF, 1, 3), "def1"},
		{"below every starter he could replace: nobody", player("fa", draft.RB, 60, 3), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Waivers(twelveTeamPPR(t), SeasonGames, squad, []Candidate{tc.add})[0]
			if tc.want == "" {
				if got.Replaces.Known || got.Replaces.Empty || positive(got.Gain) {
					t.Fatalf("replaces %+v gain %v, want no one and no gain", got.Replaces, got.Gain)
				}
				return
			}
			if !got.Replaces.Known || squad.Players[got.Replaces.At].ID != tc.want || !positive(got.Gain) {
				t.Fatalf("replaces %+v (gain %v), want %s", got.Replaces, got.Gain, tc.want)
			}
		})
	}
}

// Every row that gains names whom it beats, in the week order and the
// season Gain order (review H1: a D/ST off the strip named no one).
func TestEveryGainingRowNamesWhomItBeats(t *testing.T) {
	f := newFixture(t)
	for _, now := range []time.Time{saturdayNoon, tuesdayNoon} {
		out := pickupPage(t, f, now, "")
		for _, r := range out.Rows {
			if roundTenth(r.Gain) > 0 && r.Beats == nil {
				t.Errorf("%s: %s gains %v and names no one", now.Weekday(), r.Add.Player.Name, r.Gain)
			}
		}
	}
}

// assertNamesItsDrop is a row whose Beats names the player its move drops.
func assertNamesItsDrop(t *testing.T, r apitypes.WaiverRow) {
	t.Helper()
	if r.Drop == nil {
		return
	}
	if r.Beats == nil || r.Beats.HostId != r.Drop.Player.HostId || r.Beats.Name != r.Drop.Player.Name || r.Beats.OpenSpot {
		t.Fatalf("%s drops %s but Beats says %+v", r.Add.Player.Name, r.Drop.Player.Name, r.Beats)
	}
}

// The move the banner offers names the player it drops in Beats, on its
// card and on its row of the table, in the week order and the season Gain
// order alike (B14: "drop Mason" over "Beats Pitts").
func TestTheOfferedMoveNamesItsDrop(t *testing.T) {
	f := newFixture(t)
	week := pickupPage(t, f, saturdayNoon, "")
	if len(week.Pickups) == 0 {
		t.Fatal("no card on Saturday")
	}
	cards := map[string]bool{}
	for _, c := range week.Pickups {
		assertNamesItsDrop(t, c)
		if c.Drop != nil && (c.Beats.Gain == nil || *c.Beats.Gain != fv(c.WeekGain)) {
			t.Errorf("card %s: Beats gain %v, want the move's week gain %v", c.Add.Player.Name, c.Beats.Gain, c.WeekGain)
		}
		cards[c.Add.Player.HostId+"|"+boardIDOf(c.Add)] = true
	}
	for _, r := range week.Rows {
		if cards[r.Add.Player.HostId+"|"+boardIDOf(r.Add)] {
			assertNamesItsDrop(t, r)
		}
	}
	season := pickupPage(t, f, tuesdayNoon, "")
	if season.PickupOrder != apitypes.WaiverAdvicePickupOrderSeasonGain || len(season.Pickups) != 1 {
		t.Fatalf("Tuesday: order %s, strip %v", season.PickupOrder, names(season.Pickups))
	}
	assertNamesItsDrop(t, season.Pickups[0])
	assertNamesItsDrop(t, season.Rows[0])
	for _, r := range season.Rows[1:] {
		if r.Beats != nil && !r.Beats.Starter {
			t.Errorf("%s names %s, a bench player, outside the offered move", r.Add.Player.Name, r.Beats.Name)
		}
	}
}

// Free agents on injured reserve or ruled out, whose return no read gives,
// are not listed (B41), nor counted in the rows; a week's out carried over
// from a game already played stays, and a player a link asked for stays.
func TestIRAndOutFreeAgentsAreNotListed(t *testing.T) {
	f := newFixture(t)
	before := pickupPage(t, f, saturdayNoon, "")
	if len(before.Rows) < 4 {
		t.Fatalf("%d rows", len(before.Rows))
	}
	ir, out, asked := *before.Rows[0].Add.Player.BoardId, *before.Rows[1].Add.Player.BoardId, *before.Rows[2].Add.Player.BoardId
	stamp := projectionAt.Add(-24 * time.Hour)
	f.data.Designations = map[string]boards.Designation{
		ir:    {Code: "IR", AsOf: stamp},
		out:   {Code: "O", AsOf: stamp},
		asked: {Code: "IR", AsOf: stamp},
	}
	after := pickupPage(t, f, saturdayNoon, "")
	for _, r := range after.Rows {
		if id := *r.Add.Player.BoardId; id == ir || id == out || id == asked {
			t.Fatalf("%s is listed with %+v", r.Add.Player.Name, r.Add.Facts.Designation)
		}
	}
	for _, c := range after.Pickups {
		if id := *c.Add.Player.BoardId; id == ir || id == out {
			t.Fatalf("the strip offers %s", c.Add.Player.Name)
		}
	}
	if len(after.Rows) > MaxWaiverRows {
		t.Fatalf("%d rows past the cut", len(after.Rows))
	}
	focused := pickupPageFor(t, f, saturdayNoon, "", asked)
	found := false
	for _, r := range focused.Rows {
		found = found || *r.Add.Player.BoardId == asked
	}
	if !found {
		t.Error("the player a link asked for is gone from his page")
	}
}

// Every drop a move could take carries his place in the rest-of-season
// lineup the Gain is measured on (Lane 108, B81): the ten the fill starts
// are season starters, the bench is not.
func TestEveryDropCarriesItsSeasonLineupPlace(t *testing.T) {
	squad := Squad{Players: pprRoster(), Held: map[string]bool{}}
	starts := map[string]bool{}
	for _, id := range pprHost() {
		starts[id] = true
	}
	got := Waivers(twelveTeamPPR(t), SeasonGames, squad, []Candidate{player("fa", draft.RB, 10, 60)})[0]
	if len(got.Drops) == 0 {
		t.Fatal("no drops")
	}
	for _, d := range got.Drops {
		id := squad.Players[d.At].ID
		if d.SeasonStarter != starts[id] {
			t.Errorf("%s: season starter %v, want %v", id, d.SeasonStarter, starts[id])
		}
	}
	// The places the strip's Beats reads, by host id, are the same.
	mine := make([]person, len(squad.Players))
	for i, c := range squad.Players {
		mine[i] = person{cand: c}
	}
	places := seasonPlacesOf([]Waiver{got}, mine)
	for _, d := range got.Drops {
		if id := squad.Players[d.At].ID; places[id] != starts[id] {
			t.Errorf("%s: place %v, want %v", id, places[id], starts[id])
		}
	}
}

// The strip's Beats labels its drop by his rest-of-season place, never by
// this week's lineup, and says his bye in the week addressed (Lane 108,
// B81): a season starter on bye reads "Starter, bye", a bench player this
// week's lineup starts reads "Bench".
func TestTheOfferedDropIsLabelledByItsSeasonPlace(t *testing.T) {
	cases := []struct {
		name                         string
		season, thisWeek, bye        bool
		wantStarter, wantByeReported bool
	}{
		{"a season starter on bye this week", true, false, true, true, true},
		{"a bench player this week's lineup starts", false, true, false, false, false},
		{"a season starter playing this week", true, true, false, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			line := apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: "d1", Name: "Drop One"}}
			line.Facts.Bye = tc.bye
			row := apitypes.WaiverRow{Drop: &line, Drops: []apitypes.WaiverDrop{
				{HostId: "d1", StartsThisWeek: tc.thisWeek},
			}}
			got := dropBeats(row, seasonPlaces{"d1": tc.season})
			if got.Starter != tc.wantStarter || (got.Bye != nil) != tc.wantByeReported || (got.Bye != nil && !*got.Bye) {
				t.Fatalf("starter %v bye %v, want %v %v", got.Starter, got.Bye, tc.wantStarter, tc.wantByeReported)
			}
		})
	}
}

// Through the engine at the fixture's Saturday and Tuesday: each strip
// card's Beats reads its drop's season place (from the engine's own
// search, never the wire) and bye, and every other row's named player is
// a season starter with his own bye (B81).
func TestBeatsReadsTheSeasonPlaceThroughTheEngine(t *testing.T) {
	f := newFixture(t)
	for _, now := range []time.Time{saturdayNoon, tuesdayNoon} {
		out := pickupPage(t, f, now, "")
		a, err := newAdvisor(f.league, f.data, everyoneProjected(f), nil, now, nil)
		if err != nil {
			t.Fatal(err)
		}
		run, ok := a.waiverRun("")
		if !ok {
			t.Fatal("no waiver run")
		}
		places := seasonPlacesOf(run.moves, run.mine)
		roster := map[string]apitypes.PlayerLine{}
		for _, l := range out.Roster {
			roster[l.Player.HostId] = l
		}
		for _, c := range out.Pickups {
			assertDropLabel(t, now, c, places)
		}
		for _, r := range out.Rows {
			if r.Pickup || r.Beats == nil || r.Beats.OpenSpot {
				continue
			}
			if !r.Beats.Starter {
				t.Errorf("%s: %s names %s off the season lineup", now.Weekday(), r.Add.Player.Name, r.Beats.Name)
			}
			if line, ok := roster[r.Beats.HostId]; ok && (r.Beats.Bye != nil) != line.Facts.Bye {
				t.Errorf("%s: %s's Beats bye %v, %s on bye %v", now.Weekday(), r.Add.Player.Name, r.Beats.Bye, r.Beats.Name, line.Facts.Bye)
			}
		}
	}
}

// assertDropLabel is a card whose Beats reads its drop's season place and
// bye.
func assertDropLabel(t *testing.T, now time.Time, c apitypes.WaiverRow, places seasonPlaces) {
	t.Helper()
	if c.Drop == nil {
		return
	}
	if place, ok := places[c.Drop.Player.HostId]; !ok || c.Beats.Starter != place {
		t.Errorf("%s card: Beats starter %v, drop's season place %v (%v)", now.Weekday(), c.Beats.Starter, place, ok)
	}
	if (c.Beats.Bye != nil) != c.Drop.Facts.Bye {
		t.Errorf("%s card: Beats bye %v, drop on bye %v", now.Weekday(), c.Beats.Bye, c.Drop.Facts.Bye)
	}
}
