package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// withRest is the people with their rest-of-season points a game.
func withRest(people []person, rest map[string]float64) []person {
	out := make([]person, len(people))
	for i, p := range people {
		if v, ok := rest[p.cand.ID]; ok {
			p.line.RestOfSeasonPerGame = &v
		}
		out[i] = p
	}
	return out
}

func restPerson(c Candidate, rest float64) person {
	return withRest(people([]Candidate{c}), map[string]float64{c.ID: rest})[0]
}

// Beats for a row the strip does not offer (Lane 98, B14): the weakest
// player of the member's the advised lineup starts at a slot the add can
// fill, by the rest of the season a game; never a bench player, nobody
// when he tops no one, and a bye week never stands in for a name.
func TestBeatsNamesTheWeakestStarterHeWouldDisplace(t *testing.T) {
	roster := projRoster()
	week := newPickupWeek(twelveTeamPPR(t), roster, pprHost())
	mine := withRest(people(roster), map[string]float64{
		"qb1": 20, "rb1": 16, "rb2": 13, "rb3": 9, "wr1": 17, "wr2": 14, "wr3": 10, "te1": 8, "k1": 8, "def1": 7,
		"qb2": 15, "rb4": 3, "wr4": 5, "te2": 4, "wr5": 2,
	})
	cases := []struct {
		name string
		add  person
		want string
	}{
		{"a back over the flex back", restPerson(withProj(player("fa", draft.RB, 30, 10), 6), 11), "rb3"},
		{"a receiver over the third receiver, not the flex", restPerson(withProj(player("fw", draft.WR, 30, 10), 6), 9.5), "rb3"},
		{"a tight end over the starter", restPerson(withProj(player("ft", draft.TE, 30, 10), 6), 8.5), "te1"},
		{"a back on bye still names whom he displaces", restPerson(withTier(player("fb", draft.RB, 30, 10), Out), 12), "rb3"},
		{"below every starter he can replace: nobody, never the bench", restPerson(withProj(player("fa", draft.RB, 60, 1), 6), 3.5), ""},
		{"an equal figure tops no one", restPerson(withProj(player("ft", draft.TE, 30, 10), 6), 8), ""},
		{"no figure of his own", people([]Candidate{withProj(player("fa", draft.RB, 30, 10), 13)})[0], ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := week.displaced(tc.add, mine)
			if tc.want == "" {
				if got != nil {
					t.Fatalf("beats %+v, want no one", got)
				}
				return
			}
			if got == nil || got.HostId != tc.want || !got.Starter || got.OpenSpot {
				t.Fatalf("beats %+v, want the starter %s", got, tc.want)
			}
		})
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

// A week's out carried over from a game already played stays listed (Lane
// 95's designation), the rest of an out is not.
func TestListedAddKeepsACarriedOverOut(t *testing.T) {
	carried, fresh := true, false
	cases := []struct {
		name string
		d    *apitypes.InjuryDesignation
		want bool
	}{
		{"no designation", nil, true},
		{"questionable", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusQuestionable}, true},
		{"out this week", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusOut, CarriedOver: &fresh}, false},
		{"out, carried over", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusOut, CarriedOver: &carried}, true},
		{"injured reserve", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusInjuredReserve}, false},
		{"injured reserve, carried over", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusInjuredReserve, CarriedOver: &carried}, false},
		{"physically unable", &apitypes.InjuryDesignation{Status: apitypes.DesignationStatusPup}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := person{line: apitypes.PlayerLine{Facts: apitypes.WeekFacts{Designation: tc.d}}}
			if got := listedAdd(p); got != tc.want {
				t.Fatalf("listed %v, want %v", got, tc.want)
			}
		})
	}
}
