package inseason

import "github.com/jhunthrop/commish/api/internal/apitypes"

// The Waivers table's Beats cell and the adds it lists (Lane 98, B14,
// B41). The strip's set rule still reads pickupWeek.beats for the roster
// places a card takes; the cell names whom a row's move replaces.

// restPerGame is a player's rest-of-season points a game, the A game
// column: the figure the season Gain counts from.
func restPerGame(p person) (float64, bool) {
	if v := p.line.RestOfSeasonPerGame; v != nil {
		return *v, true
	}
	return 0, false
}

// displaced is the Beats cell for an add the strip does not offer: the
// weakest player of the member's the advised lineup starts at a slot the
// add can fill, by the rest of the season a game, whom the add tops; nil
// when he tops no one there or either has no figure ("if he beats nobody,
// say nothing"). His gain is the Proj difference where both have one.
func (w *pickupWeek) displaced(add person, mine []person) *apitypes.WaiverBeats {
	figure, ok := restPerGame(add)
	if !ok {
		return nil
	}
	low, lowFigure := -1, 0.0
	for i, p := range mine {
		row, starts := w.base.slotOf[i]
		if !starts || !w.base.starts[i] || !w.base.slots[row].accepts(add.cand.Position) {
			continue
		}
		v, ok := restPerGame(p)
		if !ok || roundTenth(v) >= roundTenth(figure) {
			continue
		}
		if low < 0 || v < lowFigure {
			low, lowFigure = i, v
		}
	}
	if low < 0 {
		return nil
	}
	p := mine[low]
	out := &apitypes.WaiverBeats{HostId: p.cand.ID, Name: p.line.Player.Name, Starter: true}
	if add.cand.HasProj && p.cand.HasProj {
		gain := roundTenth(add.cand.Proj - p.cand.Proj)
		out.Gain = &gain
	}
	return out
}

// dropBeats is the Beats cell for the move the strip offers: the player
// that move drops, whether this week's lineup starts him, and the move's
// week gain (null where the row's is). A move with no drop keeps the
// row's own Beats.
func dropBeats(row apitypes.WaiverRow) *apitypes.WaiverBeats {
	if row.Drop == nil {
		return row.Beats
	}
	starts := false
	for _, d := range row.Drops {
		if d.HostId == row.Drop.Player.HostId {
			starts = d.StartsThisWeek
		}
	}
	return &apitypes.WaiverBeats{HostId: row.Drop.Player.HostId, Name: row.Drop.Player.Name, Starter: starts, Gain: row.WeekGain}
}

// offered is the rows with the strip's adds naming their own drop in
// Beats (B14): the card a row is for is the move the banner offers.
func offered(rows, cards []apitypes.WaiverRow) []apitypes.WaiverRow {
	on := make(map[string]bool, len(cards))
	for _, c := range cards {
		on[c.Add.Player.HostId+"|"+boardIDOf(c.Add)] = true
	}
	out := make([]apitypes.WaiverRow, len(rows))
	for i, r := range rows {
		if on[r.Add.Player.HostId+"|"+boardIDOf(r.Add)] {
			r.Beats = dropBeats(r)
		}
		out[i] = r
	}
	return out
}

func boardIDOf(line apitypes.PlayerLine) string {
	if line.Player.BoardId == nil {
		return ""
	}
	return *line.Player.BoardId
}

// seasonLongLists are the designations that keep a player out for weeks.
var seasonLongLists = map[apitypes.DesignationStatus]bool{
	apitypes.DesignationStatusInjuredReserve: true,
	apitypes.DesignationStatusPup:            true,
	apitypes.DesignationStatusNfi:            true,
}

// listedAdd is whether the table lists a free agent (B41): not one on a
// season-long list or ruled out, whose return no read gives (the
// injury captures carry no return week), so he is no pickup and no
// stash. A week's out carried over from a game already played (Lane 95)
// stays: that listing predates the week the page addresses.
func listedAdd(p person) bool {
	d := p.line.Facts.Designation
	if d == nil {
		return true
	}
	if seasonLongLists[d.Status] {
		return false
	}
	carried := d.CarriedOver != nil && *d.CarriedOver
	return d.Status != apitypes.DesignationStatusOut || carried
}
