package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// The founder's trade on real figures (Lane 269 fix round 1, HIGH-1):
// his ESPN league as its newest read stood on 2026-10-28T04:08Z, valued
// on the rest-of-season board published 2026-10-27 (weeks 8 to 18, the
// championship over 17 and 18), each player's waiver level the best
// free agent at his position in that read a side could start (QB -14.1,
// RB -21.4, WR -16.6, TE -1.7; fix round 2 left out De'Von Achane, a free
// back ruled out at -14.5). The rosters are the two teams' active players as the advisor
// read them, copied from that read (lane269_real), never production.

// founderWeeks is the weeks the read's figures cover.
const founderWeeks = 11

// founderConfig is the league's lineup: QB, two RB, two WR, TE, a flex,
// K, DEF and seven on the bench.
var founderConfig = []draft.SlotConfig{
	{Slot: draft.SlotQB, Count: 1, EligiblePositions: []draft.Position{draft.QB}},
	{Slot: draft.SlotRB, Count: 2, EligiblePositions: []draft.Position{draft.RB}},
	{Slot: draft.SlotWR, Count: 2, EligiblePositions: []draft.Position{draft.WR}},
	{Slot: draft.SlotTE, Count: 1, EligiblePositions: []draft.Position{draft.TE}},
	{Slot: draft.SlotFlex, Count: 1, EligiblePositions: []draft.Position{draft.RB, draft.WR, draft.TE}},
	{Slot: draft.SlotK, Count: 1, EligiblePositions: []draft.Position{draft.K}},
	{Slot: draft.SlotDEF, Count: 1, EligiblePositions: []draft.Position{draft.DEF}},
	{Slot: draft.SlotBench, Count: 7, EligiblePositions: []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE, draft.K, draft.DEF}},
}

// founderMine is the founder's team, Irving among them.
func founderMine() Squad {
	return Squad{Starters: []string{"4429795", "4047646", "4596448", "3915416", "4431611", "4385690", "4360569", "-16010"}, Players: []Candidate{
		{ID: "4429795", Position: draft.RB, Rank: 1, Value: 152.6000, HasValue: true, PerGame: 28.5000, HasPerGame: true, Proj: 22.8, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000}, // Jahmyr Gibbs
		{ID: "4047646", Position: draft.WR, Rank: 59, Value: -27.5000, HasValue: true, PerGame: 6.4000, HasPerGame: true, Proj: 15.7, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000}, // A.J. Brown
		{ID: "4258173", Position: draft.WR, Rank: 24, Value: 22.2000, HasValue: true, PerGame: 15.2000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: -16.6000},       // Nico Collins
		{ID: "4596448", Position: draft.RB, Rank: 16, Value: 38.2000, HasValue: true, PerGame: 15.7000, HasPerGame: true, Proj: 15.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000}, // Bucky Irving
		{ID: "3915416", Position: draft.WR, Rank: 72, Value: -39.2000, HasValue: true, PerGame: 9.1000, HasPerGame: true, Proj: 10.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000}, // DJ Moore
		{ID: "4360248", Position: draft.TE, Rank: 18, Value: -6.0000, HasValue: true, PerGame: 9.0000, HasPerGame: true, Proj: 8.2, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -1.7000},    // Kyle Pitts Sr.
		{ID: "4431611", Position: draft.QB, Rank: 18, Value: -9.6000, HasValue: true, PerGame: 20.9000, HasPerGame: true, Proj: 17.5, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -14.1000}, // Caleb Williams
		{ID: "4870795", Position: draft.WR, Rank: 50, Value: -20.8000, HasValue: true, PerGame: 7.1000, HasPerGame: true, Proj: 5.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000},  // Makai Lemon
		{ID: "2971573", Position: draft.K, Rank: 2, Value: 0.0000, HasValue: false, PerGame: 6.4000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: 0.0000},            // Ka'imi Fairbairn
		{ID: "4832955", Position: draft.RB, Rank: 55, Value: -49.0000, HasValue: true, PerGame: 4.4000, HasPerGame: true, Proj: 4.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000},  // Emmett Johnson
		{ID: "4385690", Position: draft.TE, Rank: 25, Value: -12.0000, HasValue: true, PerGame: 9.8000, HasPerGame: true, Proj: 10.5, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -1.7000},  // Dalton Kincaid
		{ID: "4432577", Position: draft.QB, Rank: 7, Value: 11.7000, HasValue: true, PerGame: 18.1000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: -14.1000},        // C.J. Stroud
		{ID: "4360569", Position: draft.RB, Rank: 54, Value: -48.7000, HasValue: true, PerGame: 9.4000, HasPerGame: true, Proj: 8.1, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000},  // Jordan Mason
		{ID: "4688813", Position: draft.WR, Rank: 34, Value: 0.0000, HasValue: true, PerGame: 8.2000, HasPerGame: true, Proj: 11.0, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000},   // Josh Downs
		{ID: "-16010", Position: draft.DEF, Rank: 22, Value: 0.0000, HasValue: false, PerGame: 4.9000, HasPerGame: true, Proj: 6.4, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: 0.0000},     // Titans D/ST
		{ID: "4426386", Position: draft.RB, Rank: 61, Value: -57.0000, HasValue: true, PerGame: 5.6000, HasPerGame: true, Proj: 0.8, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000},  // Roschon Johnson
	}}
}

// founderTheirs is the other side's, Nacua and Love among them.
func founderTheirs() Squad {
	return Squad{Starters: []string{"4426515", "4426502", "4870808", "4696981", "4431452", "4361050", "-16023", "4428718", "4568263"}, Players: []Candidate{
		{ID: "4426515", Position: draft.WR, Rank: 5, Value: 64.6000, HasValue: true, PerGame: 22.7000, HasPerGame: true, Proj: 23.0, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000},  // Puka Nacua
		{ID: "4426502", Position: draft.WR, Rank: 16, Value: 34.7000, HasValue: true, PerGame: 15.1000, HasPerGame: true, Proj: 16.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000}, // Drake London
		{ID: "4870808", Position: draft.RB, Rank: 35, Value: -22.6000, HasValue: true, PerGame: 10.2000, HasPerGame: true, Proj: 9.9, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000}, // Jeremiyah Love
		{ID: "16800", Position: draft.WR, Rank: 0, Value: 33.8000, HasValue: true, PerGame: 17.0000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: true, FreeLevel: -16.6000},           // Davante Adams
		{ID: "4696981", Position: draft.RB, Rank: 24, Value: 0.0000, HasValue: true, PerGame: 11.7000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: -21.4000},        // Cam Skattebo
		{ID: "4431452", Position: draft.QB, Rank: 9, Value: 10.3000, HasValue: true, PerGame: 19.5000, HasPerGame: true, Proj: 21.8, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -14.1000},  // Drake Maye
		{ID: "4432620", Position: draft.WR, Rank: 12, Value: 36.9000, HasValue: true, PerGame: 15.3000, HasPerGame: true, Proj: 15.3, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000}, // Parker Washington
		{ID: "2976212", Position: draft.WR, Rank: 28, Value: 13.2000, HasValue: true, PerGame: 13.9000, HasPerGame: true, Proj: 11.9, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000}, // Stefon Diggs
		{ID: "4361050", Position: draft.TE, Rank: 3, Value: 43.0000, HasValue: true, PerGame: 15.8000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: -1.7000},         // Isaiah Likely
		{ID: "3929645", Position: draft.TE, Rank: 9, Value: 4.3000, HasValue: true, PerGame: 9.6000, HasPerGame: true, Proj: 0.0, HasProj: false, Tier: Out, Locked: false, InjuredReserve: false, FreeLevel: -1.7000},           // Juwan Johnson
		{ID: "-16023", Position: draft.DEF, Rank: 9, Value: 0.0000, HasValue: false, PerGame: 8.0000, HasPerGame: true, Proj: 10.8, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: 0.0000},     // Steelers D/ST
		{ID: "4686361", Position: draft.K, Rank: 9, Value: 0.0000, HasValue: false, PerGame: 5.8000, HasPerGame: true, Proj: 7.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: 0.0000},       // Cam Little
		{ID: "4428718", Position: draft.WR, Rank: 23, Value: 23.1000, HasValue: true, PerGame: 14.3000, HasPerGame: true, Proj: 9.6, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -16.6000},  // Tre Tucker
		{ID: "14880", Position: draft.QB, Rank: 17, Value: -8.3000, HasValue: true, PerGame: 18.5000, HasPerGame: true, Proj: 15.7, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -14.1000},   // Kirk Cousins
		{ID: "4249836", Position: draft.RB, Rank: 51, Value: -42.2000, HasValue: true, PerGame: 8.3000, HasPerGame: true, Proj: 1.2, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: -21.4000},  // Pierre Strong Jr.
		{ID: "4568263", Position: draft.K, Rank: 51, Value: 0.0000, HasValue: false, PerGame: 7.2000, HasPerGame: true, Proj: 6.5, HasProj: true, Tier: Available, Locked: false, InjuredReserve: false, FreeLevel: 0.0000},      // Ryan Fitzgerald
	}}
}

// Bucky Irving for Puka Nacua and Jeremiyah Love: the verdict the founder
// saw (+1.4 a week for his lineup, +1.8 for theirs), and the rest of
// season that refuses it. They take in Irving at 59.6 over the free back
// and give Nacua at 81.2 over the free receiver; Love, under the free
// back, counts none. -21.6 is past the 11.0 the weeks allow, so the finder
// drops it and the builder answers it unacceptable to them.
func TestTheFoundersTradeOnRealFigures(t *testing.T) {
	mine, theirs := founderMine(), founderTheirs()
	give := []int{indexOf(mine.Players, "4596448")}
	get := []int{indexOf(theirs.Players, "4426515"), indexOf(theirs.Players, "4870808")}
	got := Check(founderConfig, founderWeeks, mine, theirs, give, get)
	if roundTenth(got.MyGain) != 1.4 || roundTenth(got.TheirGain) != 1.8 {
		t.Fatalf("the verdict: mine %.1f, theirs %.1f a week, want 1.4 and 1.8", got.MyGain, got.TheirGain)
	}
	if roundTenth(got.MyRest) != 21.6 || roundTenth(got.TheirRest) != -21.6 || GiveUp(founderWeeks) != 11 {
		t.Fatalf("rest of season mine %v, theirs %v, limit %v", got.MyRest, got.TheirRest, GiveUp(founderWeeks))
	}
	if Acceptable(got.TheirRest, founderWeeks) || !Acceptable(got.MyRest, founderWeeks) {
		t.Fatalf("acceptable: theirs %v, mine %v", Acceptable(got.TheirRest, founderWeeks), Acceptable(got.MyRest, founderWeeks))
	}
	if got.Drop < 0 || mine.Players[got.Drop].ID != "4426386" {
		t.Fatalf("the drop %d, want Roschon Johnson", got.Drop)
	}
	found := Trades(founderConfig, founderWeeks, mine, theirs, "", 1000)
	if len(found) == 0 {
		t.Fatal("the finder lists nothing with them, so the test proves less")
	}
	for _, tr := range found {
		if holds(mine.Players, tr.Give, "4596448") && holds(theirs.Players, tr.Get, "4426515") {
			t.Fatalf("the finder lists Irving for Nacua: %+v", tr)
		}
		if !Acceptable(tr.MyRest, founderWeeks) || !Acceptable(tr.TheirRest, founderWeeks) {
			t.Fatalf("the finder lists %+v", tr)
		}
	}
}
