package inseason

import (
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// MaxPickups is how many pickups the Waivers strip names at most.
const MaxPickups = 3

// weekLineup is the lineup the advice sets this week (Lineup, the Lineup
// screen's rule) from the roster: its Proj as the screen prints and sums
// it, who starts by roster index, the slot each starter fills, and the
// slots no one who can play fills.
type weekLineup struct {
	proj   float64
	starts []bool
	slotOf map[int]int
	idle   []bool
}

// weekOf sets the week's lineup for roster with the host's starters, as
// the Lineup screen does. A spot no one who can play fills counts 0.
func weekOf(config []draft.SlotConfig, roster []Candidate, hostStarters []string) weekLineup {
	rows := Lineup(config, roster, hostStarters)
	out := weekLineup{starts: make([]bool, len(roster)), slotOf: map[int]int{}, idle: make([]bool, len(rows))}
	for i, r := range rows {
		if r.Ours < 0 || r.NoOneCanPlay {
			out.idle[i] = true
			continue
		}
		out.starts[r.Ours] = true
		out.slotOf[r.Ours] = i
		if c := roster[r.Ours]; c.HasProj {
			out.proj += c.Proj
		}
	}
	out.proj = roundTenth(out.proj)
	return out
}

// pickupWeek is one request's week for the waiver rows: the roster, the
// host's starters and the lineup the advice sets without any add.
type pickupWeek struct {
	config       []draft.SlotConfig
	roster       []Candidate
	hostStarters []string
	base         weekLineup
	// open is the roster spots free: a card with no drop takes one
	// (rereview N1).
	open int
}

func newPickupWeek(config []draft.SlotConfig, roster []Candidate, hostStarters []string) *pickupWeek {
	return &pickupWeek{config: config, roster: roster, hostStarters: hostStarters, base: weekOf(config, roster, hostStarters),
		open: max(rosterSpots(config)-len(roster), 0)}
}

// swapped is roster less the player with the id drop ("" for none), with
// add last.
func swapped(roster []Candidate, drop string, add Candidate) []Candidate {
	out := make([]Candidate, 0, len(roster)+1)
	for _, c := range roster {
		if drop == "" || c.ID != drop {
			out = append(out, c)
		}
	}
	return append(out, add)
}

// with is this week's Proj gain to the lineup with add in and the roster
// player at drop out (-1 for none), whether add starts, and whether he
// fills a starting spot no one of the member's can play (the open spot).
func (w *pickupWeek) with(add Candidate, drop int) (gain float64, starts, open bool) {
	id := ""
	if drop >= 0 {
		id = w.roster[drop].ID
	}
	after := swapped(w.roster, id, add)
	lineup := weekOf(w.config, after, w.hostStarters)
	at := len(after) - 1
	if !lineup.starts[at] {
		return 0, false, false
	}
	slot := lineup.slotOf[at]
	return roundTenth(lineup.proj - w.base.proj), true, slot < len(w.base.idle) && w.base.idle[slot]
}

// beats is the member's player at add's position with the lowest Proj
// add tops, the advised lineup's starters first, then the bench; nil when
// add cannot play this week, has no Proj or tops no one. A player of the
// member's who cannot play this week is never named (review 66f M3).
func (w *pickupWeek) beats(add Candidate, mine []person) *apitypes.WaiverBeats {
	if add.Tier != Available || !add.HasProj {
		return nil
	}
	for _, starter := range []bool{true, false} {
		low := -1
		for i, p := range mine {
			c := p.cand
			if c.Position != add.Position || !c.HasProj || c.Tier != Available || w.base.starts[i] != starter || add.Proj <= c.Proj {
				continue
			}
			if low < 0 || c.Proj < mine[low].cand.Proj {
				low = i
			}
		}
		if low >= 0 {
			p := mine[low]
			gain := roundTenth(add.Proj - p.cand.Proj)
			return &apitypes.WaiverBeats{HostId: p.cand.ID, Name: p.line.Player.Name, Starter: starter, Gain: &gain}
		}
	}
	return nil
}

// isPickup is the strip's rule (Lane 66f): he starts this week, the
// lineup's Proj rises, and the rest of the season does not fall.
func isPickup(row apitypes.WaiverRow) bool {
	return row.Starts && row.WeekGain != nil && *row.WeekGain > 0 && roundTenth(row.Gain) >= 0
}

// setCandidate is one add the strip may name: the add, his drop (a roster
// index, -1 for none) and the roster places he takes, the player he tops
// and the player he drops, in one namespace (review 66f H1).
type setCandidate struct {
	add  Candidate
	drop int
	keys []string
}

// pickupSet is the strip's cards as chosen: their indexes into the
// candidates, each card's gain over the lineup with the cards before it
// made, and the lineup's Proj with every card made.
type pickupSet struct {
	chosen []int
	gains  []float64
	proj   float64
}

// set chooses the strip's pickups as a set (review 66f H1): in the order
// given (the highest week gain alone first), each card is measured against
// the lineup with the cards already chosen made, and kept only while he
// still starts, still raises the Proj, takes no roster place another card
// took, and his drop is still on the roster; at most MaxPickups.
func (w *pickupWeek) set(cands []setCandidate) pickupSet {
	out := pickupSet{proj: w.base.proj}
	roster := append([]Candidate(nil), w.roster...)
	used := map[string]bool{}
	open := w.open
	for i, c := range cands {
		if len(out.chosen) == MaxPickups {
			break
		}
		// A card with no drop needs an open spot; once they are taken, it goes.
		if anyUsed(used, c.keys) || (c.drop < 0 && open == 0) {
			continue
		}
		drop := ""
		if c.drop >= 0 {
			drop = w.roster[c.drop].ID
			if !onRoster(roster, drop) {
				continue
			}
		}
		after := swapped(roster, drop, c.add)
		lineup := weekOf(w.config, after, w.hostStarters)
		gain := roundTenth(lineup.proj - out.proj)
		if !lineup.starts[len(after)-1] || gain <= 0 {
			continue
		}
		for _, k := range c.keys {
			used[k] = true
		}
		roster, out.proj = after, lineup.proj
		if c.drop < 0 {
			open--
		}
		out.chosen = append(out.chosen, i)
		out.gains = append(out.gains, gain)
	}
	return out
}

// onRoster is whether the roster has the player with the id.
func onRoster(roster []Candidate, id string) bool {
	for _, c := range roster {
		if c.ID == id {
			return true
		}
	}
	return false
}

func anyUsed(used map[string]bool, keys []string) bool {
	for _, k := range keys {
		if used[k] {
			return true
		}
	}
	return false
}

// stripMoves is the Waivers strip's moves under the week's rule (review
// 66f H1, L8): every add we rank that is a pickup on his own (he starts,
// the week rises, the rest of the season does not fall), highest week gain
// first, chosen as a set. Also the lineup's Proj with every one made.
func (r waiverRun) stripMoves() ([]Waiver, float64) {
	type ranked struct {
		move Waiver
		gain float64
	}
	var cands []ranked
	for _, m := range r.moves {
		if m.NoDrop || roundTenth(m.Gain) < 0 {
			continue
		}
		if gain, starts, _ := r.week.with(r.pool[m.Add].cand, m.Drop); starts && gain > 0 {
			cands = append(cands, ranked{move: m, gain: gain})
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].gain > cands[j].gain })
	set := make([]setCandidate, len(cands))
	for i, c := range cands {
		add := r.pool[c.move.Add].cand
		var keys []string
		if b := r.week.beats(add, r.mine); b != nil {
			keys = append(keys, b.HostId)
		}
		if c.move.Drop >= 0 {
			keys = append(keys, r.mine[c.move.Drop].cand.ID)
		}
		set[i] = setCandidate{add: add, drop: c.move.Drop, keys: keys}
	}
	chosen := r.week.set(set)
	moves := make([]Waiver, len(chosen.chosen))
	for k, i := range chosen.chosen {
		moves[k] = cands[i].move
	}
	return moves, chosen.proj
}

// strip is the strip's moves as its cards; each card's week_gain is his
// over the cards before him.
func (r waiverRun) strip(moves []Waiver) []apitypes.WaiverRow {
	return cardRows(r.w, r.week.config, r.week.hostStarters, r.mine, r.pool, moves, r.clears)
}

// cardRows is the strip's cards as rows, each measured against the lineup
// with the cards before it made (rereview N2): its week gain, whom he
// beats, its drops (a player an earlier card dropped is gone) and its
// sentence all on that base.
func cardRows(w *Writer, config []draft.SlotConfig, hostStarters []string, mine, pool []person, moves []Waiver, clears map[string]openapi_types.Date) []apitypes.WaiverRow {
	out := make([]apitypes.WaiverRow, 0, len(moves))
	cum := mine
	for _, m := range moves {
		week := newPickupWeek(config, candidates(cum), hostStarters)
		move := remap(m, mine, cum)
		row := waiverRow(w, week, cum, pool[m.Add], move, clears)
		row.Pickup = true
		// The banner's move names the player it drops (B14).
		row.Beats = dropBeats(row)
		out = append(out, row)
		cum = afterCard(cum, move.Drop, pool[m.Add])
	}
	return out
}

// candidates is the people as the engine reads them.
func candidates(people []person) []Candidate {
	out := make([]Candidate, len(people))
	for i, p := range people {
		out[i] = p.cand
	}
	return out
}

// remap is the move's drops as indexes into to, from indexes into from, by
// player; a drop no longer on to is left out (-1 for the move's own).
func remap(m Waiver, from, to []person) Waiver {
	at := func(i int) int {
		if i < 0 {
			return -1
		}
		for j, p := range to {
			if p.cand.ID == from[i].cand.ID {
				return j
			}
		}
		return -1
	}
	out := m
	out.Drop = at(m.Drop)
	out.Drops = nil
	out.Replaces = Replaced{Empty: m.Replaces.Empty}
	if m.Replaces.Known {
		if j := at(m.Replaces.At); j >= 0 {
			out.Replaces = Replaced{At: j, Known: true}
		}
	}
	for _, d := range m.Drops {
		if j := at(d.At); j >= 0 {
			out.Drops = append(out.Drops, Drop{At: j, Gain: d.Gain, StartsThisWeek: d.StartsThisWeek, SeasonStarter: d.SeasonStarter})
		}
	}
	return out
}

// afterCard is the roster once a card is made: the drop out, the add in.
func afterCard(roster []person, drop int, add person) []person {
	out := make([]person, 0, len(roster)+1)
	for i, p := range roster {
		if i != drop {
			out = append(out, p)
		}
	}
	return append(out, add)
}

// clearsOf is the day a claim on each pool player clears, by board id,
// from the platform's pool (Yahoo's waiver wire): empty when it says none.
func (a *advisor) clearsOf() map[string]openapi_types.Date {
	out := map[string]openapi_types.Date{}
	for _, p := range a.Snap.Pool {
		if p.Until == "" {
			continue
		}
		day, err := time.Parse(time.DateOnly, p.Until)
		if err != nil {
			continue
		}
		if lp := a.Player(p.PlayerID); lp.BoardId != nil {
			out[*lp.BoardId] = openapi_types.Date{Time: day}
		}
	}
	return out
}
