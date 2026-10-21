package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// people is a roster as the waiver rows read it, each named by his id.
func people(roster []Candidate) []person {
	out := make([]person, len(roster))
	for i, c := range roster {
		out[i] = person{cand: c, line: apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: c.ID, Name: c.ID}}}
	}
	return out
}

func indexOf(roster []Candidate, id string) int {
	for i, c := range roster {
		if c.ID == id {
			return i
		}
	}
	return -1
}

// This week's gain is the Lineup screen's rule (Lane 66f): the lineup's
// Proj with him in and the drop out less the lineup's without him, 0 when
// he does not start, and a player who cannot play never starts.
func TestPickupWeekGain(t *testing.T) {
	roster := projRoster()
	week := newPickupWeek(twelveTeamPPR(t), roster, pprHost())
	rb4 := indexOf(roster, "rb4")
	cases := []struct {
		name   string
		add    Candidate
		drop   int
		gain   float64
		starts bool
	}{
		// 13 takes an RB spot, rb2 (12) moves to the flex over rb3 (10.5).
		{"a back above the flex starts", withProj(player("fa", draft.RB, 30, 10), 13), rb4, 2.5, true},
		{"a back below the bench does not", withProj(player("fa", draft.RB, 60, 1), 3), rb4, 0, false},
		{"a player out this week never starts", withTier(withProj(player("fa", draft.RB, 5, 90), 30), Out), rb4, 0, false},
		{"a doubtful player never starts", withTier(withProj(player("fa", draft.RB, 5, 90), 30), Doubtful), rb4, 0, false},
		{"a player with no Proj does not start over one with", player("fa", draft.RB, 1, 200), rb4, 0, false},
		// Dropping the flex starter for a lesser back still starts the add.
		{"the drop is the starter he replaces", withProj(player("fa", draft.RB, 30, 10), 11), indexOf(roster, "rb3"), 0.5, true},
		{"a defense above the starter", withProj(player("fd", draft.DEF, 9, 0), 9.6), indexOf(roster, "def1"), 2.6, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gain, starts, _ := week.with(tc.add, tc.drop)
			if gain != tc.gain || starts != tc.starts {
				t.Fatalf("gain %v starts %v, want %v %v", gain, starts, tc.gain, tc.starts)
			}
		})
	}
}

// Beats names the member's player at his position with the lowest Proj he
// tops, the advised starters first, then the bench, with the gain in
// printed tenths; no one for a player who cannot play or has no Proj.
func TestPickupBeats(t *testing.T) {
	roster := projRoster()
	week := newPickupWeek(twelveTeamPPR(t), roster, pprHost())
	mine := people(roster)
	cases := []struct {
		name    string
		add     Candidate
		want    string
		starter bool
		gain    float64
	}{
		{"the lowest starter he tops", withProj(player("fa", draft.RB, 30, 10), 11), "rb3", true, 0.5},
		{"no starter, the lowest bench player", withProj(player("fa", draft.RB, 30, 10), 5), "rb4", false, 1},
		{"a quarterback under the starter tops the bench", withProj(player("fq", draft.QB, 30, 10), 16.2), "qb2", false, 2.2},
		{"a kicker over the starter", withProj(player("fk", draft.K, 9, 0), 8.3), "k1", true, 0.3},
		{"no one he tops", withProj(player("fa", draft.RB, 30, 10), 3), "", false, 0},
		{"on bye", withTier(withProj(player("fa", draft.RB, 5, 90), 30), Out), "", false, 0},
		{"no Proj", player("fa", draft.RB, 5, 90), "", false, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := week.beats(tc.add, mine)
			if tc.want == "" {
				if got != nil {
					t.Fatalf("beats %+v, want no one", got)
				}
				return
			}
			if got == nil || got.HostId != tc.want || got.Starter != tc.starter || fv(got.Gain) != tc.gain {
				t.Fatalf("beats %+v, want %s starter %v +%v", got, tc.want, tc.starter, tc.gain)
			}
		})
	}
}

func pickRow(beats, drop string, weekGain, gain float64, starts bool) apitypes.WaiverRow {
	r := apitypes.WaiverRow{WeekGain: fp(weekGain), Gain: gain, Starts: starts}
	if beats != "" {
		r.Beats = &apitypes.WaiverBeats{HostId: beats}
	}
	if drop != "" {
		r.Drop = &apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: drop}}
	}
	r.Pickup = isPickup(r)
	return r
}

// The pickup rule (Lane 66f): he starts this week, the lineup's Proj
// rises, and the rest of the season does not fall.
func TestPickupRule(t *testing.T) {
	if isPickup(pickRow("rb3", "wr5", 0.2, -0.3, true)) {
		t.Error("a kicker swap that costs the season is not a pickup")
	}
	if isPickup(pickRow("rb3", "wr5", 2, 1, false)) || isPickup(pickRow("rb3", "wr5", 0, 1, true)) {
		t.Error("a pickup starts and raises the week")
	}
	if !isPickup(pickRow("rb3", "wr5", 2, 0, true)) {
		t.Error("a season gain of 0 does not lower it")
	}
}

// Every player an add could replace is listed with his gain, the move's
// own drop first, then by gain; a held player is never a drop.
func TestWaiverDropsListEveryChoice(t *testing.T) {
	squad := Squad{Players: pprRoster(), Held: map[string]bool{"wr5": true}}
	got := Waivers(twelveTeamPPR(t), SeasonGames, squad, []Candidate{player("fa-rb", draft.RB, 15, 60)})[0]
	if len(got.Drops) < 2 || got.Drops[0].At != got.Drop || got.Drops[0].Gain != got.Gain {
		t.Fatalf("drops %+v, move %+v", got.Drops, got)
	}
	for i, d := range got.Drops {
		if squad.Players[d.At].ID == "wr5" {
			t.Fatal("a held player is a drop")
		}
		if i > 1 && d.Gain > got.Drops[i-1].Gain {
			t.Fatalf("drop %d out of order: %+v", i, got.Drops)
		}
	}
	open := Waivers(twelveTeamPPR(t), SeasonGames, Squad{Players: pprRoster()[:14], Open: true}, []Candidate{player("fa-rb", draft.RB, 15, 60)})[0]
	if len(open.Drops) != 0 {
		t.Fatalf("an open spot lists drops: %+v", open.Drops)
	}
}

// The waiver answer carries the new fields on the recorded league: every
// pickup is one by the rule, every drop is on the answer's roster, and
// the copy line names the platform. The week's projection is read, so the
// page is in the week order (Lane 95: with none read, the season Gain's).
func TestWaiverAnswerCarriesTheTable(t *testing.T) {
	f := newFixture(t)
	a, err := newAdvisor(f.league, f.data, everyoneProjected(f), nil, fixtureNow, nil)
	if err != nil {
		t.Fatal(err)
	}
	out, ok := a.Waivers("", "")
	if !ok {
		t.Fatal("no answer")
	}
	onRoster := map[string]bool{}
	for _, l := range out.Roster {
		onRoster[l.Player.HostId] = true
	}
	for i, r := range out.Rows {
		if r.Pickup != isPickup(r) {
			t.Fatalf("row %d pickup %v by the rule %v", i, r.Pickup, isPickup(r))
		}
		if r.Beats != nil && !onRoster[r.Beats.HostId] {
			t.Fatalf("row %d beats a player off the roster", i)
		}
		for _, d := range r.Drops {
			if !onRoster[d.HostId] {
				t.Fatalf("row %d drops a player off the roster", i)
			}
		}
		if r.Drop != nil && (len(r.Drops) == 0 || r.Drops[0].HostId != r.Drop.Player.HostId) {
			t.Fatalf("row %d: the drop is not first", i)
		}
	}
	for _, p := range out.Pickups {
		if !p.Pickup {
			t.Fatalf("a strip card is no pickup: %+v", p)
		}
	}
	if out.Moves.Reason == nil || !strings.HasPrefix(*out.Moves.Reason, "Sleeper does not take claims") {
		t.Fatalf("moves %+v", out.Moves)
	}
	guard(t, out.Basis)
	guard(t, out.SeasonBasis)
	guard(t, *out.Moves.Reason)
}
