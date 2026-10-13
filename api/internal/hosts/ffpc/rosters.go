package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// Roster is one team on the league rosters page.
type Roster struct {
	TeamID  int      `json:"team_id"`
	Name    string   `json:"name"`
	Players []Player `json:"players"`
	// Reserve is how many of the team's players the page says are on
	// injured reserve; the page does not say which.
	Reserve int `json:"reserve"`
}

// MaxRoster bounds one team's players.
const MaxRoster = 60

var irCount = regexp.MustCompile(`IR: ([0-9]{1,2})`)

// ParseRosters reads the league rosters page: every team with its
// players, each under the position column the page files him in.
func ParseRosters(page []byte) ([]Roster, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	table := first(doc, tagClass("table", "leagueRosterTable"))
	if table == nil {
		return nil, ErrNotThisPage
	}
	trs := rows(table)
	if len(trs) < 2 {
		return nil, ErrNotThisPage
	}
	header := cells(trs[0])
	var out []Roster
	for _, tr := range trs[1:] {
		if !strings.Contains(attr(tr, "id"), "trTeamNameAndRoster") {
			continue
		}
		r, ok := rosterRow(cells(tr), header)
		if ok {
			out = append(out, r)
		}
	}
	if len(out) == 0 || len(out) > MaxTeams {
		return nil, ErrNotThisPage
	}
	return out, nil
}

func rosterRow(row, header []*node) (Roster, bool) {
	if len(row) == 0 {
		return Roster{}, false
	}
	link := first(row[0], tag("a"))
	if link == nil {
		return Roster{}, false
	}
	r := Roster{TeamID: teamOf(attr(link, "href")), Name: Clean(text(link), maxName)}
	if r.TeamID == 0 {
		return Roster{}, false
	}
	if m := irCount.FindStringSubmatch(text(row[0])); m != nil {
		r.Reserve, _ = strconv.Atoi(m[1])
	}
	for i := 1; i < len(row) && i < len(header); i++ {
		pos, ok := position(text(header[i]))
		if !ok {
			continue
		}
		for _, div := range children(row[i], "div") {
			if p, ok := rosterPlayer(div, pos); ok && len(r.Players) < MaxRoster {
				r.Players = append(r.Players, p)
			}
		}
	}
	return r, true
}

// rosterPlayer reads "<a href=PlayerProfile.aspx?playerID=..>Josh
// Allen</a>&nbsp;(BUF)" under a position column.
func rosterPlayer(div *node, pos string) (Player, bool) {
	a := first(div, tag("a"))
	if a == nil {
		return Player{}, false
	}
	id := playerID(attr(a, "href"))
	name := Clean(text(a), maxName)
	if id == "" || name == "" {
		return Player{}, false
	}
	p := Player{ID: id, Name: name, Position: pos, Team: team(ownText(div))}
	if pos == DEF {
		if t, ok := isDefenseText(name); ok {
			p.Team = t
		}
		p.Name = defenseName(p.Team)
	}
	return p, true
}

// Lineup is the member's team on its lineup page: who starts, who sits,
// and the week the page is set for.
type Lineup struct {
	Week     int      `json:"week"`
	Owner    string   `json:"owner"`
	Starters []Player `json:"starters"`
	Bench    []Player `json:"bench"`
	// Slots is each starter's lineup slot as the page names it (QB, FLEX).
	Slots []string `json:"slots"`
}

var weekNum = regexp.MustCompile(`(?i)weekNum=([0-9]{1,2})`)

// ParseLineup reads the set-lineup page.
func ParseLineup(page []byte) (Lineup, error) {
	doc, err := parse(page)
	if err != nil {
		return Lineup{}, err
	}
	var l Lineup
	if a := first(doc, idSuffix("hlCurrentOpponent")); a != nil {
		if m := weekNum.FindStringSubmatch(attr(a, "href")); m != nil {
			l.Week, _ = strconv.Atoi(m[1])
		}
	}
	if owner := first(doc, idSuffix("pnlOwnerName")); owner != nil {
		if s := first(owner, tagClass("span", "banner-stat")); s != nil {
			l.Owner = Clean(text(s), maxName)
		}
	}
	starters := lineupTable(doc, "rptStartingLineup")
	bench := lineupTable(doc, "rptBench")
	if starters == nil && bench == nil {
		return Lineup{}, ErrNotThisPage
	}
	for _, row := range starters {
		l.Starters, l.Slots = append(l.Starters, row.player), append(l.Slots, row.slot)
	}
	for _, row := range bench {
		l.Bench = append(l.Bench, row.player)
	}
	return l, nil
}

type lineupRow struct {
	slot   string
	player Player
}

// lineupTable is the rows of the lineup table whose controls carry the
// repeater's name, nil when the page has no such table.
func lineupTable(doc *node, repeater string) []lineupRow {
	for _, table := range all(doc, tag("table")) {
		if first(table, idContains(repeater)) == nil {
			continue
		}
		trs := rows(table)
		if len(trs) < 1 {
			continue
		}
		col := columns(trs[0])
		out := []lineupRow{}
		for _, tr := range trs[1:] {
			if row, ok := lineupPlayer(cells(tr), col); ok {
				out = append(out, row)
			}
		}
		return out
	}
	return nil
}

func lineupPlayer(row []*node, col map[string]int) (lineupRow, bool) {
	pi, ok := col["player"]
	if !ok || pi >= len(row) {
		return lineupRow{}, false
	}
	a := first(row[pi], tag("a"))
	if a == nil {
		return lineupRow{}, false
	}
	posText, _ := cellText(row, col, "pos")
	pos, ok := position(posText)
	if !ok {
		return lineupRow{}, false
	}
	id := playerID(attr(a, "href"))
	if id == "" {
		return lineupRow{}, false
	}
	name, teamCode := lastFirst(text(a))
	p := Player{ID: id, Name: name, Position: pos, Team: teamCode}
	if pos == DEF {
		if t, ok := isDefenseText(text(a)); ok {
			p.Team = t
		}
		p.Name = defenseName(p.Team)
	}
	slot, _ := cellText(row, col, "slot")
	return lineupRow{slot: Clean(slot, 8), player: p}, true
}
