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
// it, and who starts by roster index.
type weekLineup struct {
	proj   float64
	starts []bool
}

// weekOf sets the week's lineup for roster with the host's starters, as
// the Lineup screen does. A spot no one who can play fills counts 0.
func weekOf(config []draft.SlotConfig, roster []Candidate, hostStarters []string) weekLineup {
	out := weekLineup{starts: make([]bool, len(roster))}
	for _, r := range Lineup(config, roster, hostStarters) {
		if r.Ours < 0 || r.NoOneCanPlay {
			continue
		}
		out.starts[r.Ours] = true
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
	// buf is the swapped roster, kept between calls.
	buf []Candidate
}

func newPickupWeek(config []draft.SlotConfig, roster []Candidate, hostStarters []string) *pickupWeek {
	return &pickupWeek{config: config, roster: roster, hostStarters: hostStarters, base: weekOf(config, roster, hostStarters)}
}

// with is this week's Proj gain to the lineup with add in and the roster
// player at drop out (-1 for none), and whether add starts.
func (w *pickupWeek) with(add Candidate, drop int) (float64, bool) {
	w.buf = w.buf[:0]
	for i, c := range w.roster {
		if i != drop {
			w.buf = append(w.buf, c)
		}
	}
	w.buf = append(w.buf, add)
	after := weekOf(w.config, w.buf, w.hostStarters)
	starts := after.starts[len(w.buf)-1]
	if !starts {
		return 0, false
	}
	return roundTenth(after.proj - w.base.proj), true
}

// beats is the member's player at add's position with the lowest Proj
// add tops, the advised lineup's starters first, then the bench; nil when
// add cannot play this week, has no Proj or tops no one.
func (w *pickupWeek) beats(add Candidate, mine []person) *apitypes.WaiverBeats {
	if add.Tier != Available || !add.HasProj {
		return nil
	}
	for _, starter := range []bool{true, false} {
		low := -1
		for i, p := range mine {
			c := p.cand
			if c.Position != add.Position || !c.HasProj || w.base.starts[i] != starter || add.Proj <= c.Proj {
				continue
			}
			if low < 0 || c.Proj < mine[low].cand.Proj {
				low = i
			}
		}
		if low >= 0 {
			p := mine[low]
			return &apitypes.WaiverBeats{HostId: p.cand.ID, Name: p.line.Player.Name, Starter: starter,
				Gain: roundTenth(add.Proj - p.cand.Proj)}
		}
	}
	return nil
}

// isPickup is the strip's rule (Lane 66f): he starts this week, the
// lineup's Proj rises, and the rest of the season does not fall.
func isPickup(row apitypes.WaiverRow) bool {
	return row.Starts && row.WeekGain > 0 && roundTenth(row.Gain) >= 0
}

// pickupsOf is the strip's cards: the pickups worth making, the highest
// week gain first, each topping a different player with a different drop,
// at most MaxPickups.
func pickupsOf(rows []apitypes.WaiverRow) []apitypes.WaiverRow {
	var picks []apitypes.WaiverRow
	for _, r := range rows {
		if r.Pickup {
			picks = append(picks, r)
		}
	}
	sort.SliceStable(picks, func(i, j int) bool { return picks[i].WeekGain > picks[j].WeekGain })
	out := []apitypes.WaiverRow{}
	used := map[string]bool{}
	for _, r := range picks {
		if len(out) == MaxPickups {
			break
		}
		keys := pickupKeys(r)
		if anyUsed(used, keys) {
			continue
		}
		for _, k := range keys {
			used[k] = true
		}
		out = append(out, r)
	}
	return out
}

// pickupKeys is the roster places a pickup takes: the player he tops and
// the player he drops.
func pickupKeys(r apitypes.WaiverRow) []string {
	var keys []string
	if r.Beats != nil {
		keys = append(keys, "beats:"+r.Beats.HostId)
	}
	if r.Drop != nil {
		keys = append(keys, "drop:"+r.Drop.Player.HostId)
	}
	return keys
}

func anyUsed(used map[string]bool, keys []string) bool {
	for _, k := range keys {
		if used[k] {
			return true
		}
	}
	return false
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
