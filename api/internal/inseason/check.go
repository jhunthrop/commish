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
	checked := Check(a.config, a.weeks, a.squad(mine, true), a.squad(theirs, false), give, get)
	h := a.header()
	out := apitypes.TradeCheck{Week: h.week, Basis: withPerGame(a.Board, TradeCheckBasis(a.basis, a.weeks), mine, theirs), BasisNote: BasisNote(a.settings),
		OrderBasis: h.basis, Refreshed: h.refreshed, ReadAt: h.readAt, Trade: tradeRow(mine, theirs, checked.Trade),
		Fills: apitypes.TradeFills{Yours: checked.Mine.Fills, Theirs: checked.Theirs.Fills,
			YoursOpen: a.openLabel(checked.Mine), TheirsOpen: a.openLabel(checked.Theirs),
			YoursRoom: checked.Mine.Room, TheirsRoom: checked.Theirs.Room}}
	out.HostTradesUrl, out.HostNote = a.host(TradesPage)
	return out, nil, true
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
// people: the finder's rows and the builder's answer alike.
func tradeRow(mine, theirs []person, tr Trade) apitypes.TradeRow {
	row := apitypes.TradeRow{Give: lines(mine, tr.Give), Get: lines(theirs, tr.Get),
		MyGain: roundTenth(tr.MyGain), TheirGain: roundTenth(tr.TheirGain), CloseForThem: tr.CloseForThem()}
	if tr.Drop >= 0 {
		drop := mine[tr.Drop].line
		row.Drop = &drop
	}
	return row
}
