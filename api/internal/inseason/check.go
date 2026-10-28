package inseason

import (
	"fmt"
	"slices"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// maxSide is the most players a side of a built trade holds: the
// finder's reach.
const maxSide = 2

// Field names of the trade check's body and the drafter's words for them.
const (
	fieldTeam      = "team"
	fieldGive      = "give"
	fieldGet       = "get"
	giveWords      = "Pick one or two of your players, each once"
	getWords       = "Pick one or two of theirs, each once"
	otherTeamWords = "Pick another team in this league's last read."
	skillWords     = "Trades here are at QB, RB, WR and TE."
)

// refusal is a built trade the league's last read refuses: the sentence
// naming why, and the body field it is about.
type refusal struct{ field, sentence string }

// checkFields is what is wrong with a trade check's body before the
// league is read, by field: each side one or two host ids, each once.
func checkFields(in apitypes.TradeCheckInput) map[string]string {
	fields := map[string]string{}
	if !validSide(in.Give) {
		fields[fieldGive] = giveWords
	}
	if !validSide(in.Get) {
		fields[fieldGet] = getWords
	}
	return fields
}

func validSide(ids []string) bool {
	if len(ids) < 1 || len(ids) > maxSide {
		return false
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || len(id) > maxPlayerParam || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

// CheckTrade is the trade builder (Lane 61): the drafter's give for the
// other team's get, on the finder's reckoning, whatever the gains. False
// when the drafter's team is not in the read; a refusal names a team or
// player the read does not hold as asked.
func (a *advisor) CheckTrade(in apitypes.TradeCheckInput) (apitypes.TradeCheck, *refusal, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return apitypes.TradeCheck{}, nil, false
	}
	other, ok := a.Snap.TeamByRoster(in.Team)
	if !ok || in.Team == a.Me {
		return apitypes.TradeCheck{}, &refusal{fieldTeam, otherTeamWords}, true
	}
	mine, theirs := a.active(team), a.active(other)
	give, r := a.pick(team, mine, in.Give, fieldGive, "your")
	if r != nil {
		return apitypes.TradeCheck{}, r, true
	}
	get, r := a.pick(other, theirs, in.Get, fieldGet, possessive(other.Name))
	if r != nil {
		return apitypes.TradeCheck{}, r, true
	}
	checked := Check(a.config, a.weeks, a.squad(team, mine, true), a.squad(other, theirs, false), give, get)
	week := a.tradeWeek(team, other, mine, theirs, checked.Trade)
	h := a.header()
	un := UncountedOf(a.settings, a.season.Carries)
	out := apitypes.TradeCheck{Week: h.week, Basis: TradeCheckBasis, BasisNote: un.Note, BasisNoteList: &un.Names,
		OrderBasis: h.basis, Refreshed: h.refreshed, ReadAt: h.readAt, Trade: a.tradeRow(mine, theirs, checked.Trade, week),
		Fills: apitypes.TradeFills{Yours: checked.Mine.Fills, Theirs: checked.Theirs.Fills,
			YoursOpen: a.openLabel(checked.Mine), TheirsOpen: a.openLabel(checked.Theirs),
			YoursRoom: checked.Mine.Room, TheirsRoom: checked.Theirs.Room},
		Totals: apitypes.TradeTotals{Yours: sideTotals(week.mine, checked.MineBase, checked.MyGain),
			Theirs: sideTotals(week.theirs, checked.TheirsBase, checked.TheirGain)},
		Acceptable: &apitypes.TradeAcceptable{Yours: Acceptable(checked.MyRest, a.weeks), Theirs: Acceptable(checked.TheirRest, a.weeks)}}
	restBasis := RestOfSeasonBasis(a.basis, a.weeks, a.horizon, false)
	out.RestOfSeasonBasis = &restBasis
	out.HostTradesUrl, out.HostNote = a.host(TradesPage)
	return out, nil, true
}

// weekSide is one side's Proj total this week before and after a trade,
// each lineup set as the Lineup screen sets it (Lane 66g); nil both with
// no projection read.
type weekSide struct{ before, after *float64 }

// change is after less before, nil without a projection read.
func (w weekSide) change() *float64 {
	if w.before == nil || w.after == nil {
		return nil
	}
	d := roundTenth(*w.after - *w.before)
	return &d
}

// tradeWeek is each side's weekSide: the member loses his give and his
// drop and takes their get, they lose their get and take his give. Their
// drop, theirs to choose, is never a starter, so it moves no Proj.
type tradeWeek struct{ mine, theirs weekSide }

func (a *advisor) tradeWeek(team, other leaguesync.Team, mine, theirs []person, tr Trade) tradeWeek {
	if a.projectionReadAt() == nil {
		return tradeWeek{}
	}
	out := tr.Give
	if tr.Drop >= 0 {
		out = append(append([]int(nil), tr.Give...), tr.Drop)
	}
	return tradeWeek{
		mine:   a.weekSide(team, mine, out, candidatesAt(theirs, tr.Get)),
		theirs: a.weekSide(other, theirs, tr.Get, candidatesAt(mine, tr.Give)),
	}
}

func (a *advisor) weekSide(t leaguesync.Team, people []person, out []int, in []Candidate) weekSide {
	roster := candidatesAt(people, nil)
	before := roundTenth(WeekProj(a.config, roster, t.Starters))
	after := roundTenth(WeekProj(a.config, Swapped(roster, out, in), t.Starters))
	return weekSide{before: &before, after: &after}
}

// candidatesAt is the people at the indexes as the engine orders them,
// every one of them for nil.
func candidatesAt(people []person, at []int) []Candidate {
	if at == nil {
		out := make([]Candidate, len(people))
		for i, p := range people {
			out[i] = p.cand
		}
		return out
	}
	out := make([]Candidate, len(at))
	for i, p := range at {
		out[i] = people[p].cand
	}
	return out
}

// sideTotals is a side's totals on the wire: the week's Proj before and
// after, and the lineup strength before and after, after being before
// plus the gain as each prints so the three figures agree to the tenth.
func sideTotals(w weekSide, base, gain float64) apitypes.TradeSideTotals {
	before := roundTenth(base)
	return apitypes.TradeSideTotals{ProjBefore: w.before, ProjAfter: w.after,
		SeasonBefore: before, SeasonAfter: roundTenth(before + roundTenth(gain))}
}

// openLabel is the first slot a side leaves empty as a lineup row labels
// it, nil when it fills every slot.
func (a *advisor) openLabel(c Change) *string {
	if c.Open < 0 {
		return nil
	}
	label := SlotLabel(a.slots, c.Open)
	return &label
}

// pick is the players a side names by host id, as indexes into its active people,
// or the refusal naming the first the read does not hold as asked: not
// on the roster, in its injured reserve or taxi spot, on injured reserve,
// or a kicker or defense. whose is the roster's owner as a sentence says
// it: "your", "Muttdogs'".
func (a *advisor) pick(t leaguesync.Team, people []person, ids []string, field, whose string) ([]int, *refusal) {
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		at := -1
		for i, p := range people {
			if p.cand.ID == id {
				at = i
				break
			}
		}
		if at < 0 {
			return nil, &refusal{field, a.absentWords(t, id, whose)}
		}
		p := people[at]
		name := p.line.Player.Name
		switch {
		case p.cand.Position == draft.K:
			return nil, &refusal{field, name + " is a kicker. " + skillWords}
		case p.cand.Position == draft.DEF:
			return nil, &refusal{field, name + " is a defense. " + skillWords}
		case !skill(p.cand.Position):
			return nil, &refusal{field, fmt.Sprintf("%s plays %s. %s", name, p.cand.Position, skillWords)}
		case p.cand.InjuredReserve:
			return nil, &refusal{field, name + " is on injured reserve, so we leave him out of trades."}
		}
		out = append(out, at)
	}
	return out, nil
}

// absentWords says why a host id is not among a roster's active
// players: in its injured reserve or taxi spot, or not on it at all.
func (a *advisor) absentWords(t leaguesync.Team, hostID, whose string) string {
	for _, spot := range []struct {
		ids   []string
		words string
	}{{t.Reserve, "on injured reserve"}, {t.Taxi, "on the taxi squad"}} {
		if slices.Contains(spot.ids, hostID) {
			return fmt.Sprintf("%s is %s, so we leave him out of trades.", a.Player(hostID).Name, spot.words)
		}
	}
	name := "That player"
	if a.rostered(hostID) {
		name = a.Player(hostID).Name
	}
	return fmt.Sprintf("%s is not on %s roster in the league's last read.", name, whose)
}

// rostered reports whether any roster in the read holds the host id.
func (a *advisor) rostered(hostID string) bool {
	for _, t := range a.Snap.Teams {
		if slices.Contains(t.Players, hostID) {
			return true
		}
	}
	return false
}

// possessive is a team's name as its owner: "Team 2's", "Muttdogs'".
func possessive(name string) string {
	if strings.HasSuffix(strings.ToLower(name), "s") {
		return name + "'"
	}
	return name + "'s"
}

// tradeRow is a trade on the wire, its players' lines from each side's
// people, with each side's change in this week's Proj: the finder's rows
// and the builder's answer alike.
func (a *advisor) tradeRow(mine, theirs []person, tr Trade, week tradeWeek) apitypes.TradeRow {
	row := apitypes.TradeRow{Give: lines(mine, tr.Give), Get: lines(theirs, tr.Get),
		MyGain: roundTenth(tr.MyGain), TheirGain: roundTenth(tr.TheirGain), CloseForThem: tr.CloseForThem(),
		MyProjChange: week.mine.change(), TheirProjChange: week.theirs.change(),
		MyRestOfSeason: tenthOf(tr.MyRest), TheirRestOfSeason: tenthOf(tr.TheirRest)}
	if tr.Drop >= 0 {
		drop := mine[tr.Drop].line
		row.Drop = &drop
	}
	if tr.Drop >= 0 && tr.DropFor >= 0 && tr.DropSlot >= 0 && tr.ForSlot >= 0 {
		w := &Writer{Basis: a.basis, Now: a.now}
		reason := w.StarterDrop(mine[tr.Drop].words, theirs[tr.Get[tr.DropFor]].words, SlotLabel(a.slots, tr.DropSlot),
			SlotLabel(a.slots, tr.ForSlot), TradeMove)
		row.DropReason = &reason
	}
	// The need is said only where it is why a kept player's trade is
	// listed (Lane 103 fix round 1, HIGH-1), on the finder and the builder.
	if needSaid(tr, candidatesAt(mine, nil)) {
		need := TradeNeedWords(SlotLabel(a.slots, tr.Need), sentOnBye(mine, tr.Give), a.week, a.week != a.Snap.Week)
		row.Need = &need
	}
	return row
}

// tenthOf is a figure to the tenth, for an optional field on the wire.
func tenthOf(v float64) *float64 {
	t := roundTenth(v)
	return &t
}

// sentOnBye is the first player at give whose club is on bye the week the
// page addresses, nil for none.
func sentOnBye(people []person, give []int) *Line {
	for _, g := range give {
		if people[g].words.Facts.Bye {
			return &people[g].words
		}
	}
	return nil
}
