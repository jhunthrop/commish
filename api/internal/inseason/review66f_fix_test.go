package inseason

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The strip's pickups are a set (review H1): each card is measured against
// the lineup with the cards before it made, so two adds that meet in the
// flex add what they add together, a card that no longer starts once the
// first is made is left out, and the set's Proj is the lineup's with all.
func TestPickupsAreChosenAsASet(t *testing.T) {
	roster := projRoster() // base 120.5: rb3 10.5 in the flex, wr3 11 the third receiver
	week := newPickupWeek(twelveTeamPPR(t), roster, pprHost())
	rb4, wr5 := indexOf(roster, "rb4"), indexOf(roster, "wr5")
	back := withProj(player("fa-rb", draft.RB, 30, 10), 13)      // +2.5 alone: rb2 12 moves to the flex
	receiver := withProj(player("fa-wr", draft.WR, 40, 5), 11.5) // +1.0 alone: wr3 11 moves to the flex
	edge := withProj(player("fa-wr2", draft.WR, 45, 5), 10.8)    // +0.3 alone, in the flex over rb3
	cases := []struct {
		name  string
		cands []setCandidate
		want  []string
		gains []float64
		proj  float64
	}{
		{"two adds meeting in the flex add together, not apart",
			[]setCandidate{{add: back, drop: rb4}, {add: receiver, drop: wr5}},
			[]string{"fa-rb", "fa-wr"}, []float64{2.5, 0.5}, 123.5},
		{"a card that no longer starts once the first is made is left out",
			[]setCandidate{{add: back, drop: rb4}, {add: edge, drop: wr5}},
			[]string{"fa-rb"}, []float64{2.5}, 123},
		{"a card whose drop the first card beats is left out: one key for both",
			[]setCandidate{{add: back, drop: rb4, keys: []string{"rb3", "rb4"}}, {add: receiver, drop: wr5, keys: []string{"wr3", "rb3"}}},
			[]string{"fa-rb"}, []float64{2.5}, 123},
		{"no card leaves the lineup's own Proj",
			nil, nil, nil, 120.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := week.set(tc.cands)
			var ids []string
			for _, i := range got.chosen {
				ids = append(ids, tc.cands[i].add.ID)
			}
			if !equal(ids, tc.want) || len(got.gains) != len(tc.gains) || got.proj != tc.proj {
				t.Fatalf("chosen %v gains %v proj %v, want %v %v %v", ids, got.gains, got.proj, tc.want, tc.gains, tc.proj)
			}
			for i, g := range got.gains {
				if g != tc.gains[i] {
					t.Fatalf("gains %v, want %v", got.gains, tc.gains)
				}
			}
		})
	}
}

// Beats never names a player of the member's who cannot play this week
// (review M3a), and an add who fills a starting spot no one of the
// member's can play reads as the open spot, said by the API (M3b); one who
// starts in the flex over another position is no open spot.
func TestBeatsSkipsWhoCannotPlayAndSaysTheOpenSpot(t *testing.T) {
	config := twelveTeamPPR(t)
	// The starting tight end is out with a Proj of 3, the bench one starts at 5.
	hurt := set(projSet(projRoster(), "te1", 3), "te1", func(c Candidate) Candidate { return withTier(c, Out) })
	week := newPickupWeek(config, hurt, pprHost())
	if got := week.beats(withProj(player("fa-te", draft.TE, 30, 5), 4), people(hurt)); got != nil {
		t.Fatalf("beats %+v, want no one: the out tight end cannot play", got)
	}
	// Both tight ends are out: the TE spot has no one who can play.
	empty := set(hurt, "te2", func(c Candidate) Candidate { return withTier(c, Out) })
	week = newPickupWeek(config, empty, pprHost())
	gain, starts, open := week.with(withProj(player("fa-te", draft.TE, 30, 5), 4), indexOf(empty, "wr5"))
	if !starts || !open || gain != 4 {
		t.Fatalf("gain %v starts %v open %v, want 4 true true", gain, starts, open)
	}
	week = newPickupWeek(config, projRoster(), pprHost())
	_, starts, open = week.with(withProj(player("fa-wr", draft.WR, 45, 5), 10.8), indexOf(projRoster(), "wr5"))
	if !starts || open {
		t.Fatalf("starts %v open %v, want a flex start that is no open spot", starts, open)
	}
}

// A failed claim check keeps what the check knew and always sets the line
// under the verb (review M2), as the Lineup's does.
func TestWaiversKeepTheReasonOnAFailedCheck(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	reason := "Claims are not sent to ESPN from here yet, so add him on ESPN's waiver page."
	s.Moves = &fakeMoves{err: errors.New("the allow list did not answer"),
		partialClaim: apitypes.WaiverMoves{TakesWrites: true, Reason: &reason}}
	_, env := serve(t, s, leaguePath+"waivers")
	var kept apitypes.WaiverAdvice
	if err := json.Unmarshal(env.Data, &kept); err != nil || kept.Moves.Claim != apitypes.WaiverMovesClaimUnavailable ||
		!kept.Moves.TakesWrites || kept.Moves.Reason == nil || *kept.Moves.Reason != reason {
		t.Fatalf("kept: %+v %v", kept.Moves, err)
	}
	s.Moves = &fakeMoves{err: errors.New("the connection store did not answer")}
	_, env = serve(t, s, leaguePath+"waivers")
	var fallback apitypes.WaiverAdvice
	want := CopyOnlyClaims(f.league.Snap.Ref.Host).Reason
	if err := json.Unmarshal(env.Data, &fallback); err != nil || fallback.Moves.Reason == nil || *fallback.Moves.Reason != *want {
		t.Fatalf("fallback: %+v %v", fallback.Moves, err)
	}
}
