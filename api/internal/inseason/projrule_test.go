package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// withProj gives a candidate this week's projection as the screen prints it.
func withProj(c Candidate, proj float64) Candidate { c.Proj, c.HasProj = proj, true; return c }

// projRoster is pprRoster with a projection on everyone, each starter the
// highest at his slot, so the host's lineup is the advice's.
func projRoster() []Candidate {
	proj := map[string]float64{
		"qb1": 18, "rb1": 15, "rb2": 12, "wr1": 17, "wr2": 13, "wr3": 11, "te1": 9, "rb3": 10.5, "k1": 8, "def1": 7,
		"qb2": 14, "rb4": 4, "wr4": 6, "te2": 5, "wr5": 2,
	}
	out := pprRoster()
	for i := range out {
		out[i] = withProj(out[i], proj[out[i].ID])
	}
	return out
}

func projSet(roster []Candidate, id string, proj float64) []Candidate {
	return set(roster, id, func(c Candidate) Candidate { return withProj(c, proj) })
}

func noProj(roster []Candidate, id string) []Candidate {
	return set(roster, id, func(c Candidate) Candidate { c.Proj, c.HasProj = 0, false; return c })
}

// The advice rule (Lane 66e): the lineup starts the highest Proj the
// screen shows at each slot after the designations and byes; the
// rest-of-season order breaks ties and stands in where nobody has one.
// Kickers and defenses follow it.
func TestLineupStartsTheHighestProj(t *testing.T) {
	cases := []struct {
		name   string
		roster []Candidate
		want   []string
	}{
		{"every starter has the highest Proj: set", projRoster(), nil},
		{"a bench quarterback with the higher Proj starts over a higher-ranked one",
			projSet(projRoster(), "qb2", 18.5), []string{"qb2 over qb1"}},
		{"a bench receiver with the higher Proj starts and the lowest starter sits",
			projSet(projRoster(), "wr4", 12), []string{"wr4 over rb3"}},
		{"the flex goes to the higher Proj across positions",
			projSet(projRoster(), "wr4", 11), []string{"wr4 over rb3"}},
		{"a Questionable player keeps his number and starts",
			set(projSet(projRoster(), "qb2", 18.5), "qb2", func(c Candidate) Candidate { return withTier(c, Available) }),
			[]string{"qb2 over qb1"}},
		{"a doubtful player sits whatever his Proj",
			set(projSet(projRoster(), "qb2", 30), "qb2", func(c Candidate) Candidate { return withTier(c, Doubtful) }), nil},
		{"an out player sits whatever his Proj",
			set(projSet(projRoster(), "wr1", 30), "wr1", func(c Candidate) Candidate { return withTier(c, Out) }),
			[]string{"wr4 over wr1"}},
		{"a bye sits: the next with a Proj starts",
			set(projRoster(), "rb1", func(c Candidate) Candidate { return withTier(c, Out) }), []string{"wr4 over rb1"}},
		{"a tie on Proj goes to the rest-of-season order",
			projSet(projSet(projRoster(), "qb1", 16), "qb2", 16), nil},
		{"a tie on Proj goes to the order, the higher-ranked bench player starting",
			projSet(set(projSet(projRoster(), "qb1", 16), "qb2", func(c Candidate) Candidate { c.Rank = 2; return c }), "qb2", 16),
			[]string{"qb2 over qb1"}},
		{"a player with a Proj starts over one without",
			noProj(projSet(projRoster(), "te2", 1), "te1"), []string{"te2 over te1"}},
		{"with no Proj at a slot the order stands in",
			noProj(noProj(projRoster(), "te1"), "te2"), nil},
		{"a kicker follows the rule", append(projRoster(), withProj(player("k2", draft.K, 20, 0), 9.5)),
			[]string{"k2 over k1"}},
		{"a defense follows the rule", append(projRoster(), withProj(player("def2", draft.DEF, 25, 0), 7.1)),
			[]string{"def2 over def1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows := Lineup(twelveTeamPPR(t), tc.roster, pprHost())
			if got := changes(rows, tc.roster); !equal(got, tc.want) {
				t.Fatalf("changes %v, want %v\n%v", got, tc.want, lineupWords(rows, tc.roster))
			}
		})
	}
}

// A player who cannot play this week never starts, even with nobody else
// for the spot: the member's current player stays, marked, and no change
// is advised (Lane 66e ruling, review M5).
func TestNoOneWhoCannotPlayIsAdvised(t *testing.T) {
	doubtful := set(projSet(projRoster(), "te1", 9), "te1", func(c Candidate) Candidate { return withTier(c, Doubtful) })
	bothOut := set(doubtful, "te2", func(c Candidate) Candidate { return withTier(c, Out) })
	rows := Lineup(twelveTeamPPR(t), bothOut, pprHost())
	if got := changes(rows, bothOut); got != nil {
		t.Fatalf("a change into a spot nobody can play: %v", got)
	}
	te := rows[6]
	if te.Slot.Type != draft.SlotTE || bothOut[te.Ours].ID != "te1" || te.Changed || !te.NoOneCanPlay {
		t.Fatalf("the TE spot: %+v %v", te, lineupWords(rows, bothOut))
	}
	for i, r := range rows {
		if i != 6 && r.NoOneCanPlay {
			t.Fatalf("spot %d marked: %v", i, lineupWords(rows, bothOut))
		}
	}
	// A doubtful starter sits for an available one whatever his Proj.
	if got := changes(Lineup(twelveTeamPPR(t), doubtful, pprHost()), doubtful); !equal(got, []string{"te2 over te1"}) {
		t.Fatalf("doubtful sits: %v", got)
	}
	// An out starter in the flex with nobody left who can play the flex.
	thin := []Candidate{}
	for _, c := range projRoster() {
		if c.ID != "rb4" && c.ID != "wr4" && c.ID != "te2" && c.ID != "wr5" {
			thin = append(thin, c)
		}
	}
	thin = set(thin, "rb3", func(c Candidate) Candidate { return withTier(c, Out) })
	flex := Lineup(twelveTeamPPR(t), thin, pprHost())
	if got := changes(flex, thin); got != nil {
		t.Fatalf("the flex: %v", got)
	}
	if f := flex[7]; f.Slot.Type != draft.SlotFlex || thin[f.Ours].ID != "rb3" || !f.NoOneCanPlay {
		t.Fatalf("the flex spot: %v", lineupWords(flex, thin))
	}
}

// The superflex takes the highest Proj left across its positions, and
// never a player who cannot play.
func TestSuperflexTakesTheHighestProjLeft(t *testing.T) {
	roster := []Candidate{
		withProj(player("qb1", draft.QB, 3, 90), 21), withProj(player("qb2", draft.QB, 20, 10), 17.5),
		withProj(player("rb1", draft.RB, 5, 80), 15), withProj(player("rb2", draft.RB, 12, 50), 12),
		withProj(player("rb3", draft.RB, 30, 20), 9), withProj(player("wr1", draft.WR, 4, 85), 16),
		withProj(player("wr2", draft.WR, 18, 40), 11), withProj(player("wr3", draft.WR, 40, 15), 8),
		withProj(player("te1", draft.TE, 6, 30), 10), withProj(player("k1", draft.K, 3, 0), 8),
		withProj(player("def1", draft.DEF, 3, 0), 7),
	}
	host := []string{"qb1", "rb1", "rb2", "wr1", "wr2", "te1", "rb3", "wr3", "k1", "def1"}
	rows := Lineup(tenTeamHalfSuperflex(t), roster, host)
	if got := changes(rows, roster); !equal(got, []string{"qb2 over wr3"}) {
		t.Fatalf("the superflex: %v\n%v", got, lineupWords(rows, roster))
	}
	out := set(roster, "qb2", func(c Candidate) Candidate { return withTier(c, Out) })
	if got := changes(Lineup(tenTeamHalfSuperflex(t), out, host), out); got != nil {
		t.Fatalf("an out quarterback took the superflex: %v", got)
	}
}

// The strength and the trade search keep the rest-of-season order: a
// week's projection never enters them.
func TestProjStaysOutOfTheSeasonOrder(t *testing.T) {
	a, b := withProj(player("a", draft.QB, 10, 50), 30), withProj(player("b", draft.QB, 2, 90), 1)
	if within(&a, &b, false) || across(&a, &b, false) {
		t.Fatal("the season order ranked by a week's projection")
	}
	if !within(&a, &b, true) || !across(&a, &b, true) {
		t.Fatal("the week's order ignored the projection")
	}
}
