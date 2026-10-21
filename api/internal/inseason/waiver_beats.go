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
func dropBeats(row apitypes.WaiverRow, places seasonPlaces) *apitypes.WaiverBeats {
	if row.Drop == nil {
		return row.Beats
	}
	id := row.Drop.Player.HostId
	return &apitypes.WaiverBeats{HostId: id, Name: row.Drop.Player.Name, Starter: places[id],
		Bye: byeOf(*row.Drop), Gain: row.WeekGain}
}

// seasonPlaces is whether the rest-of-season lineup the Gain is measured
// on starts each player of the member's, by host id (Lane 108, B81): the
// strip's Beats labels its drop by it. Server-side only, never on the wire.
type seasonPlaces map[string]bool

// seasonPlacesOf is the places the searched moves' drops carry (every
// move's own drop is among its Drops), mine their squad.
func seasonPlacesOf(moves []Waiver, mine []person) seasonPlaces {
	out := seasonPlaces{}
	for _, m := range moves {
		for _, d := range m.Drops {
			if d.At >= 0 && d.At < len(mine) {
				out[mine[d.At].cand.ID] = d.SeasonStarter
			}
		}
	}
	return out
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
func offered(rows, cards []apitypes.WaiverRow, places seasonPlaces) []apitypes.WaiverRow {
	on := make(map[string]bool, len(cards))
	for _, c := range cards {
		on[c.Add.Player.HostId+"|"+boardIDOf(c.Add)] = true
	}
	out := make([]apitypes.WaiverRow, len(rows))
	for i, r := range rows {
		if on[r.Add.Player.HostId+"|"+boardIDOf(r.Add)] {
			r.Beats = dropBeats(r, places)
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
