package inseason

import (
	"net/http"
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// The kickers' and defenses' tabs in season (Lane 66w). We have no model
// for either, so there is no rest-of-season order: the tab is the week,
// one row a club in the order of the week's published projection, each
// with its game, Opp rank, Avg and Last, and in a league whose roster
// holds it and an add on the first few free rows.

// addsShown is how many free rows still to play carry the add: the
// first five, so the tab is not a column of buttons (the 66w ruling).
const addsShown = 5

// weekOrderPositionWords names the positions the week's tab lists.
const weekOrderPositionWords = "Pick a position: K or DEF"

// weekOrderPositions are the positions the week's tab lists.
var weekOrderPositions = map[draft.Position]bool{draft.K: true, draft.DEF: true}

// parseWeekOrderPosition reads ?position=, or names the field it refuses.
func parseWeekOrderPosition(r *http.Request) (draft.Position, map[string]string) {
	position := draft.Position(r.URL.Query().Get(fieldPosition))
	if !weekOrderPositions[position] {
		return "", map[string]string{fieldPosition: weekOrderPositionWords}
	}
	return position, nil
}

// weekRow is one club's row before its marks.
type weekRow struct {
	boardID string
	p       person
	section apitypes.WeekOrderRowSection
	// adp is the drafts' price on him, nil when they do not price him.
	adp *float64
}

// sectionOf is where a row's game puts it: still to play, kicked off by
// the read's clock (or final), or on bye.
func sectionOf(f Facts) apitypes.WeekOrderRowSection {
	switch {
	case f.Bye:
		return apitypes.WeekOrderRowSectionBye
	case f.Locked:
		return apitypes.WeekOrderRowSectionKickedOff
	}
	return apitypes.WeekOrderRowSectionToPlay
}

// WeekOrder is the week's tab for kickers or defenses. marks gives the
// rows the league's rosters and the add; false for the reader with no
// league of their own.
func (a *advisor) WeekOrder(position draft.Position, marks bool) apitypes.WeekOrderAdvice {
	out := apitypes.WeekOrderAdvice{Week: a.Snap.Week, Position: apitypes.WeekOrderAdvicePosition(position),
		UncountedRules: len(uncountedRulesAt(a.settings, a.season.Carries, position)), ProjectionReadAt: a.projectionReadAt(),
		ProjectionScoring: projectionScoring(a.settings, a.preset), Rows: []apitypes.WeekOrderRow{}}
	var hosts map[string]string
	if marks {
		readAt := a.Snap.ReadAt
		out.ReadAt = &readAt
		hosts = a.hostIDs()
	}
	rows := a.clubRows(position, hosts)
	sort.SliceStable(rows, func(i, j int) bool { return weekBefore(rows[i], rows[j]) })
	adds := 0
	for _, r := range rows {
		row := apitypes.WeekOrderRow{Line: r.p.line, Section: r.section}
		if marks {
			mark := a.rosterMark(r.boardID)
			row.Roster = &mark
			if mark.Kind == apitypes.RosterMarkKindFree && r.section == apitypes.WeekOrderRowSectionToPlay && adds < addsShown && a.starts(position) {
				add := apitypes.WeekOrderRowMoveAdd
				row.Move = &add
				adds++
			}
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}

// clubRows is one row a club at the position: of the board's players
// there, the one clubPick prefers.
func (a *advisor) clubRows(position draft.Position, hosts map[string]string) []weekRow {
	byClub := map[string]weekRow{}
	var clubs []string
	for _, p := range a.Board.Raw.Players {
		if p.Position != position || p.Team == "" {
			continue
		}
		r := a.weekRowOf(p, hosts)
		held, ok := byClub[p.Team]
		if !ok {
			clubs = append(clubs, p.Team)
		}
		if !ok || a.clubPick(r, held) {
			byClub[p.Team] = r
		}
	}
	out := make([]weekRow, 0, len(clubs))
	for _, club := range clubs {
		out = append(out, byClub[club])
	}
	return out
}

func (a *advisor) weekRowOf(p boards.Player, hosts map[string]string) weekRow {
	person := a.boardPerson(p, hosts)
	return weekRow{boardID: p.ID, p: person, section: sectionOf(person.words.Facts), adp: p.ADP}
}

// clubPick reports whether x stands for its club over y: the one the
// week's projection names (the higher Proj if both), else the one who
// played for it last. Before either (week 1, before its projection), the
// one a roster in the league holds, else the one the drafts price lower.
// A club fields one kicker; a stale kicker the directory still lists on it
// is never the club's.
func (a *advisor) clubPick(x, y weekRow) bool {
	lx, ly := x.p.line, y.p.line
	if decided, better := higher(lx.WeekProjection, ly.WeekProjection); decided {
		return better
	}
	if wx, wy := lastWeek(lx), lastWeek(ly); wx != wy {
		return wx > wy
	}
	_, hx := a.HeldBy[x.boardID]
	_, hy := a.HeldBy[y.boardID]
	if hx != hy {
		return hx
	}
	return lowerADP(x.adp, y.adp)
}

// lowerADP is whether x's ADP is priced and before y's (or y has none).
func lowerADP(x, y *float64) bool {
	if x == nil || y == nil {
		return x != nil
	}
	return *x < *y
}

// lastWeek is the week of his newest counted game, 0 with none.
func lastWeek(line apitypes.PlayerLine) int {
	if len(line.Facts.LastGames) == 0 {
		return 0
	}
	return line.Facts.LastGames[0].Week
}

// weekBefore is the tab's order: the games still to play by Proj, ties
// by Avg; then the games kicked off by kickoff; then the clubs on bye by
// Avg; a name settles the rest.
func weekBefore(x, y weekRow) bool {
	if x.section != y.section {
		return sectionPlace(x.section) < sectionPlace(y.section)
	}
	lx, ly := x.p.line, y.p.line
	if x.section == apitypes.WeekOrderRowSectionKickedOff && !lx.Facts.Kickoff.Equal(*ly.Facts.Kickoff) {
		return lx.Facts.Kickoff.Before(*ly.Facts.Kickoff)
	}
	if decided, better := higher(lx.WeekProjection, ly.WeekProjection); decided {
		return better
	}
	if decided, better := higher(lx.SeasonAvg, ly.SeasonAvg); decided {
		return better
	}
	return lx.Player.Name < ly.Player.Name
}

// sectionPlace is a section's place in the tab.
func sectionPlace(s apitypes.WeekOrderRowSection) int {
	switch s {
	case apitypes.WeekOrderRowSectionToPlay:
		return 0
	case apitypes.WeekOrderRowSectionKickedOff:
		return 1
	}
	return 2
}

// higher compares two figures, a held one before none: decided is false
// when they are equal or both absent.
func higher(x, y *float64) (decided, better bool) {
	switch {
	case x == nil && y == nil:
		return false, false
	case x == nil || y == nil:
		return true, x != nil
	case *x != *y:
		return true, *x > *y
	}
	return false, false
}

// leagueWeekOrder is GET /leagues/attached/{id}/order/week.
func (s *Service) leagueWeekOrder(w http.ResponseWriter, r *http.Request) {
	position, bad := parseWeekOrderPosition(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out := a.WeekOrder(position, true)
	moves := s.claimMoves(r, a)
	out.Moves = &moves
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// publicWeekOrder is GET /order/week: the tab in PublicSettings' scoring,
// with no account and no league.
func (s *Service) publicWeekOrder(w http.ResponseWriter, r *http.Request) {
	position, bad := parseWeekOrderPosition(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, err := s.publicAdvisor(r.Context())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: week order", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, a.WeekOrder(position, false))
}
