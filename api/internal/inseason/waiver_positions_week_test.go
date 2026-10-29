package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Lane 291 review: the position panel with the week's projection read.

// everyProjection is a week 6 Proj for every skill player on the
// fixture's board, rostered or free, varied by his place on the board; no
// kicker or defense carries one.
func everyProjection(f fixture) boards.WeekProjection {
	players := map[string]boards.ProjectedPoints{}
	for i, p := range f.raw.Players {
		if p.Position != draft.K && p.Position != draft.DEF {
			players[p.ID] = boards.ProjectedPoints{PPR: 3 + float64(i*13%17)*0.9, Half: 1, Standard: 1}
		}
	}
	return boards.WeekProjection{Week: 6, ReadAt: fixtureNow.Add(-1), Players: players}
}

// projectedAdvisor is the fixture on the rest-of-season board with the
// week's projection read.
func projectedAdvisor(t *testing.T) *advisor {
	t.Helper()
	f := newFixture(t)
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderRestOfSeason, 7
	a, err := newAdvisor(f.league, f.data, everyProjection(f), map[string]bool{}, fixtureNow, nil)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func skilledCard(card apitypes.WaiverPositionCard) bool {
	return card.Position != apitypes.WaiverPositionCardPositionK && card.Position != apitypes.WaiverPositionCardPositionDEF
}

// Review M1 and M4: with the week's projection read, a position with a
// Proj ranks this week and lists this week's best free agents by Proj; a
// position where no one carries a Proj (the kicker and defense here) has
// no week figure, never a shared rank 1 on 0.0.
func TestWaiverPanelThisWeek(t *testing.T) {
	out, ok := projectedAdvisor(t).Waivers("", "")
	if !ok || out.Positions == nil || out.ProjectionReadAt == nil {
		t.Fatalf("no panel with the projection read: %v", ok)
	}
	for _, card := range *out.Positions {
		if !skilledCard(card) {
			if card.Week != nil || card.AvailableWeek != nil {
				t.Fatalf("%s ranks this week with no Proj: %+v", card.Position, card.Week)
			}
			continue
		}
		if card.Week == nil || card.AvailableWeek == nil {
			t.Fatalf("%s has no week figure or list", card.Position)
		}
		week := *card.AvailableWeek
		if len(week) == 0 || len(week) > PanelFree {
			t.Fatalf("%s lists %d this week", card.Position, len(week))
		}
		for i, free := range week {
			proj := free.Row.Add.WeekProjection
			if proj == nil {
				t.Fatalf("%s lists %s this week with no Proj", card.Position, free.Row.Add.Player.Name)
			}
			if i > 0 && *proj > *week[i-1].Row.Add.WeekProjection {
				t.Fatalf("%s's week list not by Proj", card.Position)
			}
		}
	}
}

// sameBeats is two Beats cells naming the same player with the same gain.
func sameBeats(a, b *apitypes.WaiverBeats) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.HostId == b.HostId && a.Name == b.Name && a.Starter == b.Starter && a.OpenSpot == b.OpenSpot &&
		fv(a.Gain) == fv(b.Gain) && (a.Bye == nil) == (b.Bye == nil)
}

// Review M3: a free agent's row the page's rows do not carry is built by
// the table's rule and goes through its Beats pass, so a strip pickup's
// panel row names the drop the strip names, as the table's row does.
func TestPanelRowNamesTheStripsDrop(t *testing.T) {
	page, run, ok := projectedAdvisor(t).waiverAnswer("", "")
	if !ok || len(page.Pickups) == 0 {
		t.Fatalf("no strip to test with: %v, %d pickups", ok, len(page.Pickups))
	}
	table := map[string]apitypes.WaiverRow{}
	for _, r := range page.Rows {
		table[rowKey(r.Add)] = r
	}
	// The same page with no rows: every panel row is built by panelRow.
	cut := page
	cut.Rows = nil
	free := panelFreeOf(run, cut)
	for _, card := range page.Pickups {
		id := boardIDOf(card.Add)
		got := free.at(draft.Position(card.Add.Player.Position), byPoints, func(c Candidate) bool { return c.ID == id })
		want, listed := table[rowKey(card.Add)]
		if len(got) != 1 || !listed {
			t.Fatalf("%s: %d panel rows, listed %v", card.Add.Player.Name, len(got), listed)
		}
		row := got[0].Row
		if !sameBeats(row.Beats, want.Beats) {
			t.Fatalf("%s: panel Beats %+v, table's %+v", card.Add.Player.Name, row.Beats, want.Beats)
		}
		if card.Drop == nil || row.Beats.HostId != card.Drop.Player.HostId {
			t.Fatalf("%s: panel Beats does not name the strip's drop", card.Add.Player.Name)
		}
		// The rule's figures match; the sentence's frame varies with the writer's turn, not the rule.
		if row.Gain != want.Gain || fv(row.WeekGain) != fv(want.WeekGain) || row.Pickup != want.Pickup || row.Starts != want.Starts {
			t.Fatalf("%s: panel row (%v, %v, %v) differs from the table's (%v, %v, %v)", card.Add.Player.Name,
				row.Gain, fv(row.WeekGain), row.Pickup, want.Gain, fv(want.WeekGain), want.Pickup)
		}
	}
}
