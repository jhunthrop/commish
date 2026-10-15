package inseason

import (
	"math"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func dropID(w Waiver, squad Squad) string {
	if w.Drop < 0 {
		return "-"
	}
	return squad.Players[w.Drop].ID
}

func TestWaiverGainAndDrop(t *testing.T) {
	back := player("fa-rb", draft.RB, 15, 60)
	weak := player("fa-wr", draft.WR, 70, 0.5)
	cases := []struct {
		name     string
		squad    Squad
		add      Candidate
		drop     string
		gain     float64
		starts   bool
		noDrop   bool
		positive bool
	}{
		{"a back who starts: the drop is the bench player it costs least to lose",
			Squad{Players: pprRoster()}, back, "wr5", (60 - 25) / 17.0, true, false, true},
		{"a held player is never the drop",
			Squad{Players: pprRoster(), Held: map[string]bool{"wr5": true}}, back, "te2", (60 - 25) / 17.0, true, false, true},
		{"an open spot needs no drop",
			Squad{Players: pprRoster(), Open: true}, back, "-", (60 - 25) / 17.0, true, false, true},
		{"nobody here starts: no gain",
			Squad{Players: pprRoster()}, weak, "wr5", 0, false, false, false},
		{"a starter the candidate does not displace is never the drop",
			Squad{Players: pprRoster(), Held: map[string]bool{"qb2": true, "rb4": true, "wr4": true, "te2": true, "wr5": true}},
			weak, "-", 0, false, true, false},
		{"a spare defense may go for a skill player",
			Squad{Players: append(without(pprRoster(), []int{14}), player("def1b", draft.DEF, 0, 0)),
				Held: map[string]bool{"qb2": true, "rb4": true, "wr4": true, "te2": true}},
			back, "def1b", (60 - 25) / 17.0, true, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Waivers(twelveTeamPPR(t), SeasonGames, c.squad, []Candidate{c.add})[0]
			if dropID(got, c.squad) != c.drop || !near(got.Gain, c.gain) || got.Starts != c.starts || got.NoDrop != c.noDrop ||
				positive(got.Gain) != c.positive {
				t.Fatalf("got drop %s gain %v starts %v no drop %v, want %s %v %v %v",
					dropID(got, c.squad), got.Gain, got.Starts, got.NoDrop, c.drop, c.gain, c.starts, c.noDrop)
			}
		})
	}
}

// With one defense and every bench player held, the defense is not the
// drop: the move has nobody to drop.
func TestWaiverKeepsTheOnlyDefense(t *testing.T) {
	squad := Squad{Players: pprRoster(), Held: map[string]bool{"qb2": true, "rb4": true, "wr4": true, "te2": true, "wr5": true}}
	got := Waivers(twelveTeamPPR(t), SeasonGames, squad, []Candidate{player("fa-rb", draft.RB, 15, 60)})[0]
	if dropID(got, squad) == "def1" || dropID(got, squad) == "k1" {
		t.Fatalf("dropped the only %s", dropID(got, squad))
	}
}

// Positive gains come first by gain, the rest below by points over
// replacement.
func TestWaiverOrder(t *testing.T) {
	pool := []Candidate{
		player("small", draft.WR, 50, 3), player("big", draft.RB, 10, 90), player("mid", draft.RB, 18, 40),
		player("none", draft.TE, 30, 1),
	}
	got := Waivers(twelveTeamPPR(t), SeasonGames, Squad{Players: pprRoster()}, pool)
	var order []string
	for _, w := range got {
		order = append(order, pool[w.Add].ID)
	}
	if !equal(order, []string{"big", "mid", "small", "none"}) {
		t.Fatalf("order %v", order)
	}
	if positive(got[2].Gain) || positive(got[3].Gain) {
		t.Fatalf("gains %v %v, want none for players who do not start", got[2].Gain, got[3].Gain)
	}
}

// The gain is on the rest of the season: a star on bye or out this week
// costs what he costs any week, so he is never the cheapest drop.
func TestWaiverNeverDropsAStarOutThisWeek(t *testing.T) {
	back := player("fa-rb", draft.RB, 15, 60)
	healthy := Waivers(twelveTeamPPR(t), SeasonGames, Squad{Players: pprRoster()}, []Candidate{back})[0]
	for _, tier := range []Tier{Out, Doubtful} {
		squad := Squad{Players: set(pprRoster(), "rb1", func(c Candidate) Candidate { return withTier(c, tier) })}
		got := Waivers(twelveTeamPPR(t), SeasonGames, squad, []Candidate{back})[0]
		if dropID(got, squad) != dropID(healthy, squad) || !near(got.Gain, healthy.Gain) {
			t.Fatalf("tier %d: drop %s gain %v, want %s %v as when healthy", tier, dropID(got, squad), got.Gain, dropID(healthy, squad), healthy.Gain)
		}
	}
}
