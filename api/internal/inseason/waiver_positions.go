package inseason

import (
	"maps"
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The Waivers screen's position panel (Lane 291): at each position the
// league starts, where the member's starters stand against every team's
// (the trade finder's team profile, Lane 287, its fill counted by
// position), his players there and the best free agents there, each with
// the table's own row.

// PanelPositions is the panel's positions in the order a lineup lists
// them.
var PanelPositions = []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE, draft.K, draft.DEF}

// panelPositionsOf is the panel's positions a league's starting spots
// take, a flex or superflex spot adding none of its own.
func panelPositionsOf(slots []Slot) []draft.Position {
	var out []draft.Position
	for _, p := range PanelPositions {
		if startsAny(slots, p) {
			out = append(out, p)
		}
	}
	return out
}

// PanelFree is how many free agents a card lists at most.
const PanelFree = 5

// StandingOf is team me's place among figures (1 the most, teams level at
// the printed tenth sharing a place), its figure and the median's, each a
// tenth.
func StandingOf(figures []float64, me int) apitypes.WaiverStanding {
	mine := roundTenth(figures[me])
	rank := 1
	for _, f := range figures {
		if roundTenth(f) > mine {
			rank++
		}
	}
	return apitypes.WaiverStanding{Rank: rank, Points: mine, Median: roundTenth(median(figures))}
}

// NeedPositions is the positions the profile's needs mark: a need at a
// spot one position fills marks it; a need at a shared spot marks each of
// its positions where the member's rank is below the league's middle
// (ranks by position, of teams).
func (l TradeLeague) NeedPositions(needs []Need, ranks map[draft.Position]int, teams int) map[draft.Position]bool {
	out := map[draft.Position]bool{}
	for _, n := range needs {
		s := l.slots[n.Slot]
		if !s.shared() {
			out[s.Eligible[0]] = true
			continue
		}
		for _, p := range s.Eligible {
			if rank, ok := ranks[p]; ok && skill(p) && 2*rank > teams+1 {
				out[p] = true
			}
		}
	}
	return out
}

// WeekByPosition is this week's Proj of the starters at each position in
// the lineup the advice sets (Lineup, the host's starters kept where
// their games have kicked off), and who it starts by roster index.
func WeekByPosition(config []draft.SlotConfig, roster []Candidate, hostStarters []string) (map[draft.Position]float64, []bool) {
	out := map[draft.Position]float64{}
	starts := make([]bool, len(roster))
	for _, r := range Lineup(config, roster, hostStarters) {
		if r.Ours < 0 || r.NoOneCanPlay {
			continue
		}
		c := roster[r.Ours]
		starts[r.Ours] = true
		if c.HasProj {
			out[c.Position] += c.Proj
		}
	}
	return out, starts
}

// panelTeam is one team as the panel reads it: its figures by position
// over the rest of the season and this week.
type panelTeam struct {
	season, week map[draft.Position]float64
}

// waiverPositions is the panel for the full page: nil when the member's
// team is not in the read or the board carries no rest-of-season points.
func (a *advisor) waiverPositions(run waiverRun, page apitypes.WaiverAdvice) *[]apitypes.WaiverPositionCard {
	if !carriesPerGame(a.Board) {
		return nil
	}
	league := a.tradeLeague()
	me, ok := a.teamIndex()
	if !ok || me >= len(league.Positions) {
		return nil
	}
	weekRead := page.ProjectionReadAt != nil
	teams := make([]panelTeam, len(a.Snap.Teams))
	var myStarts []bool
	pointed := pointedPositions(candidates(run.pool))
	for i, t := range a.Snap.Teams {
		teams[i].season = league.Positions[i]
		cands := candidates(a.active(t))
		maps.Copy(pointed, pointedPositions(cands))
		if !weekRead {
			continue
		}
		week, starts := WeekByPosition(a.config, cands, t.Starters)
		teams[i].week = week
		if i == me {
			myStarts = starts
		}
	}
	mine := candidates(run.mine)
	starter := league.Starting(mine)
	ranks := map[draft.Position]int{}
	cards := []apitypes.WaiverPositionCard{}
	for _, p := range panelPositionsOf(a.slots) {
		card :=apitypes.WaiverPositionCard{Position: apitypes.WaiverPositionCardPosition(p), Teams: len(teams),
			Mine: panelMine(run.mine, p, starter, myStarts), Available: panelFree(run, page, p)}
		if pointed[p] {
			card.RestOfSeason = standingAt(teams, me, p, func(t panelTeam) map[draft.Position]float64 { return t.season })
			ranks[p] = card.RestOfSeason.Rank
		}
		if weekRead {
			card.Week = standingAt(teams, me, p, func(t panelTeam) map[draft.Position]float64 { return t.week })
		}
		cards = append(cards, card)
	}
	need := league.NeedPositions(league.Needs(league.Profile(mine)), ranks, len(teams))
	for i := range cards {
		cards[i].Need = need[draft.Position(cards[i].Position)]
	}
	return &cards
}

// pointedPositions is the positions where any of the players carries
// rest-of-season points: a position with none has no figure to rank by.
func pointedPositions(cands []Candidate) map[draft.Position]bool {
	out := map[draft.Position]bool{}
	for _, c := range cands {
		if c.HasPoints {
			out[c.Position] = true
		}
	}
	return out
}

// standingAt is the member's standing at p among the teams' figures.
func standingAt(teams []panelTeam, me int, p draft.Position, of func(panelTeam) map[draft.Position]float64) *apitypes.WaiverStanding {
	figures := make([]float64, len(teams))
	for i, t := range teams {
		figures[i] = of(t)[p]
	}
	s := StandingOf(figures, me)
	return &s
}

// teamIndex is the member's team's place in the read's teams.
func (a *advisor) teamIndex() (int, bool) {
	for i, t := range a.Snap.Teams {
		if t.RosterID == a.Me {
			return i, true
		}
	}
	return 0, false
}

// seasonPoints is a player's rest-of-season points as the wire prints them.
func seasonPoints(c Candidate) *float64 {
	if !c.HasPoints {
		return nil
	}
	v := roundTenth(c.Points)
	return &v
}

// byPoints orders by rest-of-season points, highest first, none last.
func byPoints(a, b Candidate) bool {
	if a.HasPoints != b.HasPoints {
		return a.HasPoints
	}
	return a.Points > b.Points
}

// panelMine is the member's players at p, by rest-of-season points.
func panelMine(mine []person, p draft.Position, starter, startsThisWeek []bool) []apitypes.WaiverPositionPlayer {
	var at []int
	for i, person := range mine {
		if person.cand.Position == p {
			at = append(at, i)
		}
	}
	sort.SliceStable(at, func(i, j int) bool { return byPoints(mine[at[i]].cand, mine[at[j]].cand) })
	out := make([]apitypes.WaiverPositionPlayer, len(at))
	for k, i := range at {
		out[k] = apitypes.WaiverPositionPlayer{Line: mine[i].line, Starter: starter[i],
			StartsThisWeek: i < len(startsThisWeek) && startsThisWeek[i], RestOfSeasonPoints: seasonPoints(mine[i].cand)}
	}
	return out
}

// panelFree is the best free agents at p the table lists, by
// rest-of-season points, each with the table's row: the page's own where
// it carries him, else built by the same rule in the page's order.
func panelFree(run waiverRun, page apitypes.WaiverAdvice, p draft.Position) []apitypes.WaiverPositionFree {
	var moves []Waiver
	for _, m := range run.moves {
		if add := run.pool[m.Add]; add.cand.Position == p && listedMove(add, m) {
			moves = append(moves, m)
		}
	}
	sort.SliceStable(moves, func(i, j int) bool { return byPoints(run.pool[moves[i].Add].cand, run.pool[moves[j].Add].cand) })
	shown := make(map[string]apitypes.WaiverRow, len(page.Rows))
	for _, r := range page.Rows {
		shown[rowKey(r.Add)] = r
	}
	out := []apitypes.WaiverPositionFree{}
	for _, m := range moves[:min(len(moves), PanelFree)] {
		add := run.pool[m.Add]
		row, ok := shown[rowKey(add.line)]
		if !ok {
			row = run.panelRow(m, page.PickupOrder)
		}
		out = append(out, apitypes.WaiverPositionFree{Row: row, RestOfSeasonPoints: seasonPoints(add.cand)})
	}
	return out
}

// panelRow is a free agent's row the page's rows do not carry, by the
// table's rule in the page's order: no week figure past his kickoff or in
// the season order, where only the strip's first row is a pickup.
func (r waiverRun) panelRow(m Waiver, order apitypes.WaiverAdvicePickupOrder) apitypes.WaiverRow {
	row := waiverRow(r.w, r.week, r.mine, r.pool[m.Add], m, r.clears)
	if order == seasonOrder || r.pastKickoff(m) {
		row = withheldWeek(row)
	}
	if order == seasonOrder {
		row.Pickup = false
	}
	return row
}

// rowKey is a row's add as the strip and the table key him.
func rowKey(line apitypes.PlayerLine) string { return line.Player.HostId + "|" + boardIDOf(line) }
