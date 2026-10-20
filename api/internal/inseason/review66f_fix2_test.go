package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// withOpenSpots is the roster cut to leave exactly n of the league's spots
// open, the bench's last players going first.
func withOpenSpots(t *testing.T, config []draft.SlotConfig, roster []Candidate, n int) []Candidate {
	t.Helper()
	keep := rosterSpots(config) - n
	if keep > len(roster) || keep < 0 {
		t.Fatalf("a roster of %d cannot leave %d of %d spots open", len(roster), n, rosterSpots(config))
	}
	return roster[:keep]
}

// The strip never needs more roster spots than are open (rereview N1): a
// card with no drop takes an open spot while one is free; after that a
// card needs a drop or is left out, so pickups_proj is a lineup the member
// can field.
func TestPickupsUseOnlyTheOpenSpots(t *testing.T) {
	config := twelveTeamPPR(t)
	roster := withOpenSpots(t, config, projRoster(), 1)
	week := newPickupWeek(config, roster, pprHost())
	if week.open != 1 {
		t.Fatalf("open %d, want 1", week.open)
	}
	back := withProj(player("fa-rb", draft.RB, 30, 10), 13)
	receiver := withProj(player("fa-wr", draft.WR, 40, 5), 11.5)
	end := withProj(player("fa-te", draft.TE, 40, 5), 10)
	got := week.set([]setCandidate{{add: back, drop: -1}, {add: receiver, drop: -1}, {add: end, drop: -1}})
	if len(got.chosen) != 1 || got.chosen[0] != 0 {
		t.Fatalf("chosen %v, want the first no-drop card alone", got.chosen)
	}
	// A later card with a drop still comes in.
	wr4 := indexOf(roster, "wr4")
	got = week.set([]setCandidate{{add: back, drop: -1}, {add: receiver, drop: -1}, {add: end, drop: wr4}})
	if len(got.chosen) != 2 || got.chosen[1] != 2 {
		t.Fatalf("chosen %v, want the no-drop card and the card with a drop", got.chosen)
	}
	full := newPickupWeek(config, append(projRoster(), withProj(player("rb5", draft.RB, 50, 1), 1)), pprHost())
	if full.open != 0 {
		t.Fatalf("open %d on a full roster", full.open)
	}
	if got := full.set([]setCandidate{{add: back, drop: -1}}); len(got.chosen) != 0 || got.proj != full.base.proj {
		t.Fatalf("a full roster took a no-drop card: %+v", got)
	}
}

// A later card's Beats, drops and gains are measured against the lineup
// with the earlier cards made (rereview N2), the base its "+x this week"
// uses; a player an earlier card drops is no longer a drop.
func TestLaterCardsAreMeasuredAfterTheEarlierOnes(t *testing.T) {
	config := twelveTeamPPR(t)
	roster := projRoster()
	mine := people(roster)
	rb4, wr5 := indexOf(roster, "rb4"), indexOf(roster, "wr5")
	pool := people([]Candidate{
		withProj(player("fa-rb", draft.RB, 30, 10), 13),
		withProj(player("fa-wr", draft.WR, 40, 5), 11.5),
	})
	moves := []Waiver{
		{Add: 0, Drop: rb4, Drops: []Drop{{At: rb4, Gain: 1}, {At: wr5, Gain: 0.5}}},
		{Add: 1, Drop: wr5, Drops: []Drop{{At: wr5, Gain: 0.4}, {At: rb4, Gain: 0.2}}},
	}
	rows := cardRows(&Writer{Basis: RestOfSeason}, config, pprHost(), mine, pool, moves, nil)
	if len(rows) != 2 || fv(rows[0].WeekGain) != 2.5 || fv(rows[1].WeekGain) != 0.5 {
		t.Fatalf("gains %+v", rows)
	}
	second := rows[1]
	if len(second.Drops) != 1 || second.Drops[0].HostId != "wr5" || fv(second.Drops[0].WeekGain) != 0.5 {
		t.Fatalf("the second card's drops %+v, want wr5 alone at +0.5 after the first card", second.Drops)
	}
	// A card's Beats names the player its move drops, at its week gain (Lane 98, B14).
	if second.Beats == nil || second.Beats.HostId != "wr5" || fv(second.Beats.Gain) != 0.5 {
		t.Fatalf("the second card's beats %+v", second.Beats)
	}
}

// The strip end to end on the recorded league (rereview N3): every card
// is a pickup, no two take the same player of the member's, the gains
// reach pickups_proj, and the no-drop cards fit the open spots.
func TestTheStripOnTheRecordedLeague(t *testing.T) {
	f := newFixture(t)
	// A projection for everyone: the rostered at 8, the free agents from 5 to 17, so some top a starter.
	every := map[string]boards.ProjectedPoints{}
	for i, p := range f.raw.Players {
		v := 8.0
		if _, held := f.league.HeldBy[p.ID]; !held {
			v = 5 + float64(i%7)*2
		}
		every[p.ID] = boards.ProjectedPoints{PPR: v, Half: v, Standard: v}
	}
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{ReadAt: projectionAt, Players: every}, nil, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	out, ok := a.Waivers("", "")
	if !ok || out.LineupProj == nil || out.PickupsProj == nil {
		t.Fatalf("answer %v, projections %v %v", ok, out.LineupProj, out.PickupsProj)
	}
	if len(out.Pickups) == 0 || len(out.Pickups) > MaxPickups {
		t.Fatalf("%d pickups on the recorded league", len(out.Pickups))
	}
	taken := map[string]bool{}
	sum, noDrop := *out.LineupProj, 0
	for i, p := range out.Pickups {
		if !p.Pickup || !p.Starts || fv(p.WeekGain) <= 0 || roundTenth(p.Gain) < 0 {
			t.Fatalf("card %d is no pickup: %+v", i, p)
		}
		var keys []string
		// A card's Beats names its own drop (Lane 98): that player counts once.
		if p.Beats != nil && !p.Beats.OpenSpot && (p.Drop == nil || p.Beats.HostId != p.Drop.Player.HostId) {
			keys = append(keys, p.Beats.HostId)
		}
		if p.Drop != nil {
			keys = append(keys, p.Drop.Player.HostId)
		} else {
			noDrop++
		}
		for _, k := range keys {
			if taken[k] {
				t.Fatalf("card %d takes %s again", i, k)
			}
			taken[k] = true
		}
		sum = roundTenth(sum + fv(p.WeekGain))
	}
	if sum != *out.PickupsProj {
		t.Fatalf("the cards reach %v, pickups_proj is %v", sum, *out.PickupsProj)
	}
	team, _ := f.league.Snap.TeamByRoster(f.league.Me)
	if open := rosterSpots(a.config) - len(a.active(team)); noDrop > max(open, 0) {
		t.Fatalf("%d no-drop cards for %d open spots", noDrop, open)
	}
}
