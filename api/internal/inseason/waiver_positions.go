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

// PositionNeed is the card's need mark, on the rank's own measure (review
// M2): at a skill position, the member's rest-of-season figure there falls
// below the median team's by the close call a week or more over the weeks
// the figures cover. A card at or above the median never marks a need.
func PositionNeed(p draft.Position, s *apitypes.WaiverStanding, weeks int) bool {
	if s == nil || !skill(p) {
		return false
	}
	return roundTenth(s.Median-s.Points) >= roundTenth(CloseCall*float64(max(1, weeks)))
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

// panelLeague is every team's figures, the member's place among them, his
// lineup this week, and the positions any player carries a figure at:
// rest-of-season points (pointed) or this week's Proj (projected).
type panelLeague struct {
	teams              []panelTeam
	me                 int
	myStarts           []bool
	pointed, projected map[draft.Position]bool
	weekRead           bool
	weeks              int
}

// panelLeagueOf reads every team's figures: the profile's by position over
// the rest of the season, the Lineup rule's this week once the projection
// is read. False when the member's team is not in the read.
func (a *advisor) panelLeagueOf(run waiverRun, weekRead bool) (panelLeague, bool) {
	league := a.tradeLeague()
	me, ok := a.teamIndex()
	if !ok || me >= len(league.Positions) {
		return panelLeague{}, false
	}
	pool := candidates(run.pool)
	out := panelLeague{teams: make([]panelTeam, len(a.Snap.Teams)), me: me, weekRead: weekRead, weeks: league.Weeks(),
		pointed: figured(pool, func(c Candidate) bool { return c.HasPoints }), projected: map[draft.Position]bool{}}
	for i, t := range a.Snap.Teams {
		out.teams[i].season = league.Positions[i]
		cands := candidates(a.active(t))
		maps.Copy(out.pointed, figured(cands, func(c Candidate) bool { return c.HasPoints }))
		if !weekRead {
			continue
		}
		maps.Copy(out.projected, figured(cands, func(c Candidate) bool { return c.HasProj }))
		week, starts := WeekByPosition(a.config, cands, t.Starters)
		out.teams[i].week = week
		if i == me {
			out.myStarts = starts
		}
	}
	return out, true
}

// waiverPositions is the panel for the full page: nil when the member's
// team is not in the read or the board carries no rest-of-season points.
func (a *advisor) waiverPositions(run waiverRun, page apitypes.WaiverAdvice) *[]apitypes.WaiverPositionCard {
	if !carriesPerGame(a.Board) {
		return nil
	}
	l, ok := a.panelLeagueOf(run, page.ProjectionReadAt != nil)
	if !ok {
		return nil
	}
	starter := a.tradeLeague().Starting(candidates(run.mine))
	free := panelFreeOf(run, page)
	cards := []apitypes.WaiverPositionCard{}
	for _, p := range panelPositionsOf(a.slots) {
		card := apitypes.WaiverPositionCard{Position: apitypes.WaiverPositionCardPosition(p), Teams: len(l.teams),
			Mine: panelMine(run.mine, p, starter, l.myStarts), Available: free.at(p, byPoints, nil)}
		if l.pointed[p] {
			card.RestOfSeason = l.standing(p, func(t panelTeam) map[draft.Position]float64 { return t.season })
		}
		card.Need = PositionNeed(p, card.RestOfSeason, l.weeks)
		// A position no player carries a Proj at has no week figure to rank by (review M4).
		if l.weekRead && l.projected[p] {
			card.Week = l.standing(p, func(t panelTeam) map[draft.Position]float64 { return t.week })
			week := free.at(p, byProj, func(c Candidate) bool { return c.HasProj })
			card.AvailableWeek = &week
		}
		cards = append(cards, card)
	}
	return &cards
}

// figured is the positions where any of the players carries the figure.
func figured(cands []Candidate, has func(Candidate) bool) map[draft.Position]bool {
	out := map[draft.Position]bool{}
	for _, c := range cands {
		if has(c) {
			out[c.Position] = true
		}
	}
	return out
}

// standing is the member's standing at p among the teams' figures.
func (l panelLeague) standing(p draft.Position, of func(panelTeam) map[draft.Position]float64) *apitypes.WaiverStanding {
	figures := make([]float64, len(l.teams))
	for i, t := range l.teams {
		figures[i] = of(t)[p]
	}
	s := StandingOf(figures, l.me)
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

// byProj orders by this week's Proj, highest first, none last.
func byProj(a, b Candidate) bool {
	if a.HasProj != b.HasProj {
		return a.HasProj
	}
	return a.Proj > b.Proj
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

// panelFree is the free agents the table lists, the page they are drawn
// on, and the drops' places in the rest-of-season lineup for the Beats
// pass (offered).
type panelFree struct {
	run    waiverRun
	page   apitypes.WaiverAdvice
	shown  map[string]apitypes.WaiverRow
	places seasonPlaces
}

func panelFreeOf(run waiverRun, page apitypes.WaiverAdvice) panelFree {
	shown := make(map[string]apitypes.WaiverRow, len(page.Rows))
	for _, r := range page.Rows {
		shown[rowKey(r.Add)] = r
	}
	return panelFree{run: run, page: page, shown: shown, places: seasonPlacesOf(run.moves, run.mine)}
}

// at is the best free agents at p the table lists by the order better
// (those keep allows, nil for all), at most PanelFree, each with the
// table's row: the page's own where it carries him, else built by the
// same rule in the page's order (panelRow).
func (f panelFree) at(p draft.Position, better func(a, b Candidate) bool, keep func(Candidate) bool) []apitypes.WaiverPositionFree {
	var moves []Waiver
	for _, m := range f.run.moves {
		add := f.run.pool[m.Add]
		if add.cand.Position == p && listedMove(add, m) && (keep == nil || keep(add.cand)) {
			moves = append(moves, m)
		}
	}
	sort.SliceStable(moves, func(i, j int) bool { return better(f.run.pool[moves[i].Add].cand, f.run.pool[moves[j].Add].cand) })
	out := []apitypes.WaiverPositionFree{}
	for _, m := range moves[:min(len(moves), PanelFree)] {
		add := f.run.pool[m.Add]
		row, ok := f.shown[rowKey(add.line)]
		if !ok {
			row = f.run.panelRow(m, f.page, f.places)
		}
		out = append(out, apitypes.WaiverPositionFree{Row: row, RestOfSeasonPoints: seasonPoints(add.cand)})
	}
	return out
}

// panelRow is a free agent's row the page's rows do not carry, by the
// table's rule in the page's order: no week figure past his kickoff or in
// the season order, where only the strip's first row is a pickup; in the
// week order a row the strip offers names its own drop in Beats, as the
// table's rows do (offered, B14; review M3).
func (r waiverRun) panelRow(m Waiver, page apitypes.WaiverAdvice, places seasonPlaces) apitypes.WaiverRow {
	row := waiverRow(r.w, r.week, r.mine, r.pool[m.Add], m, r.clears)
	if page.PickupOrder == seasonOrder || r.pastKickoff(m) {
		row = withheldWeek(row)
	}
	if page.PickupOrder == seasonOrder {
		row.Pickup = false
		return row
	}
	return offered([]apitypes.WaiverRow{row}, page.Pickups, places)[0]
}

// rowKey is a row's add as the strip and the table key him.
func rowKey(line apitypes.PlayerLine) string { return line.Player.HostId + "|" + boardIDOf(line) }
