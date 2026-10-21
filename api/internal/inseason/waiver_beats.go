package inseason

import "github.com/jhunthrop/commish/api/internal/apitypes"

// The Waivers table's Beats cell and the adds it lists (Lane 98, B14,
// B41). The strip's set rule still reads pickupWeek.beats for the roster
// places a card takes; the cell names whom a row's move replaces.

// replacedBeats is the Beats cell for an add the strip does not offer
// (Lane 98, B14, review H1): the player his move takes out of the
// rest-of-season lineup the Gain is measured on (Waiver.Replaces), or the
// empty slot he fills there; nil when he starts in no one's place ("if he
// beats nobody, say nothing"). Its gain is the Proj difference where both
// have one.
func replacedBeats(add person, mine []person, r Replaced) *apitypes.WaiverBeats {
	if r.Empty {
		return &apitypes.WaiverBeats{OpenSpot: true, Starter: true}
	}
	if !r.Known || r.At < 0 || r.At >= len(mine) {
		return nil
	}
	p := mine[r.At]
	// The player the move takes out of the rest-of-season lineup has a
	// place in it by the fill's own rule (Lane 108, B81).
	out := &apitypes.WaiverBeats{HostId: p.cand.ID, Name: p.line.Player.Name, Starter: true, Bye: byeOf(p.line)}
	if add.cand.HasProj && p.cand.HasProj {
		gain := roundTenth(add.cand.Proj - p.cand.Proj)
		out.Gain = &gain
	}
	return out
}

// dropBeats is the Beats cell for the move the strip offers: the player
// that move drops, his place in the rest-of-season lineup (Lane 108,
// B81), his bye in the week addressed, and the move's week gain (null
// where the row's is). A move with no drop keeps the row's own Beats.
func dropBeats(row apitypes.WaiverRow) *apitypes.WaiverBeats {
	if row.Drop == nil {
		return row.Beats
	}
	starter := false
	for _, d := range row.Drops {
		if d.HostId == row.Drop.Player.HostId {
			starter = d.SeasonStarter
		}
	}
	return &apitypes.WaiverBeats{HostId: row.Drop.Player.HostId, Name: row.Drop.Player.Name, Starter: starter,
		Bye: byeOf(*row.Drop), Gain: row.WeekGain}
}

// byeOf is the Beats cell's bye: true on his bye in the week the line
// addresses, absent otherwise (Lane 108, B81).
func byeOf(line apitypes.PlayerLine) *bool {
	if !line.Facts.Bye {
		return nil
	}
	bye := true
	return &bye
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
