package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// Roster is one team on the league rosters page.
type Roster struct {
	TeamID int    `json:"team_id"`
	Name   string `json:"name"`
	// Players is every rostered player the page files anywhere but an IR
	// or taxi column: the position columns, and (inferred) a column we
	// do not know or a line under the team's name.
	Players []Player `json:"players"`
	// Reserve and Taxi are the players under a column headed IR (or
	// Injured Reserve) and one headed Taxi. Inferred, not yet seen in a
	// capture (2026-10-14): the captured page has no such column.
	Reserve []Player `json:"reserve"`
	Taxi    []Player `json:"taxi"`
	// ReserveCount is how many the page says are on injured reserve
	// ("IR: 1" under the team's name).
	ReserveCount int `json:"reserve_count"`
}

// RostersPage is the rosters page: every team, and the headings of any
// column it files players under that we do not know, so a reader can
// name them once.
type RostersPage struct {
	Teams        []Roster `json:"teams"`
	OtherColumns []string `json:"other_columns,omitempty"`
}

// MaxRoster bounds one team's players across every slot.
const MaxRoster = 60

// The slot kinds the roster and lineup pages file a player under. Only
// IR marks a player as on injured reserve.
const (
	SlotActive  = "active"
	SlotBench   = "bench"
	SlotReserve = "reserve"
	SlotTaxi    = "taxi"
	// SlotOther is a column we do not know: rostered, with no mark.
	SlotOther = "other"
)

var (
	irCount = regexp.MustCompile(`IR: ([0-9]{1,2})`)
	// posWord is a position code written beside a player outside a
	// position column: "(MIA) RB", "RB - MIA".
	posWord = regexp.MustCompile(`\b(QB|RB|WR|TE|PK|DF|DST)\b`)
	// teamWord is the team in parentheses beside a player: "(MIA)".
	teamWord = regexp.MustCompile(`\(([A-Z]{2,3})\)`)
	// irLabel is a heading or table name FFPC uses for injured reserve.
	irLabel = regexp.MustCompile(`(?i)^(IR|INJURED ?RESERVE)$`)
)

// lineTeam is the team a player's line writes beside him.
func lineTeam(line string) string {
	if m := teamWord.FindStringSubmatch(line); m != nil {
		return team(m[1])
	}
	return team(line)
}

// slotOf is the kind of a column the page files players under that is
// not a position: IR only when FFPC labels it so, taxi by its name, and
// anything else other (rostered, never marked).
func slotOf(label string) string {
	l := strings.TrimSpace(label)
	switch {
	case irLabel.MatchString(l):
		return SlotReserve
	case strings.Contains(strings.ToUpper(l), "TAXI"):
		return SlotTaxi
	}
	return SlotOther
}

func (r *Roster) size() int { return len(r.Players) + len(r.Reserve) + len(r.Taxi) }

// file adds a player under a slot kind, within MaxRoster.
func (r *Roster) file(p Player, slot string) {
	if r.size() >= MaxRoster {
		return
	}
	switch slot {
	case SlotTaxi:
		r.Taxi = append(r.Taxi, p)
	case SlotReserve:
		r.Reserve = append(r.Reserve, p)
	default:
		r.Players = append(r.Players, p)
	}
}

// ParseRosters reads the league rosters page's teams.
func ParseRosters(page []byte) ([]Roster, error) {
	p, err := ParseRostersPage(page)
	return p.Teams, err
}

// ParseRostersPage reads the league rosters page: every team with its
// players under the column the page files each in, and the headings of
// columns we do not know.
func ParseRostersPage(page []byte) (RostersPage, error) {
	doc, err := parse(page)
	if err != nil {
		return RostersPage{}, err
	}
	table := first(doc, tagClass("table", "leagueRosterTable"))
	if table == nil {
		return RostersPage{}, ErrNotThisPage
	}
	trs := rows(table)
	if len(trs) < 2 {
		return RostersPage{}, ErrNotThisPage
	}
	header := cells(trs[0])
	var out RostersPage
	for _, h := range header[min(1, len(header)):] {
		label := Clean(text(h), maxName)
		if _, known := position(label); !known && slotOf(label) == SlotOther {
			out.OtherColumns = append(out.OtherColumns, label)
		}
	}
	for _, tr := range trs[1:] {
		if !strings.Contains(attr(tr, "id"), "trTeamNameAndRoster") {
			continue
		}
		if r, ok := rosterRow(cells(tr), header); ok {
			out.Teams = append(out.Teams, r)
		}
	}
	if len(out.Teams) == 0 || len(out.Teams) > MaxTeams {
		return RostersPage{}, ErrNotThisPage
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
		r.ReserveCount, _ = strconv.Atoi(m[1])
	}
	// Inferred, not yet seen in a capture (2026-10-14): a player named
	// under the team's name is rostered; nothing there says IR, so he is
	// filed with no mark.
	for _, a := range all(row[0], tag("a")) {
		if p, ok := rosterPlayer(a, ""); ok {
			r.file(p, SlotOther)
		}
	}
	for i := 1; i < len(row) && i < len(header); i++ {
		label := Clean(text(header[i]), maxName)
		pos, active := position(label)
		slot := SlotActive
		if !active {
			slot = slotOf(label)
		}
		for _, a := range all(row[i], tag("a")) {
			if p, ok := rosterPlayer(a, pos); ok {
				r.file(p, slot)
			}
		}
	}
	return r, true
}

// rosterPlayer reads "<a href=PlayerProfile.aspx?playerID=..>Josh
// Allen</a>&nbsp;(BUF)": the link and the words after it up to the next
// player, so two players in one cell keep their own team. pos is the
// column's position; outside a position column it is read from those
// words when the page writes one, and left empty otherwise (placed by
// name).
func rosterPlayer(a *node, pos string) (Player, bool) {
	id := playerID(attr(a, "href"))
	name := Clean(text(a), maxName)
	if id == "" || name == "" {
		return Player{}, false
	}
	line := afterLink(a)
	if pos == "" {
		if m := posWord.FindStringSubmatch(line); m != nil {
			pos, _ = position(m[1])
		}
	}
	p := Player{ID: id, Name: name, Position: pos, Team: lineTeam(line)}
	if pos == DEF {
		if t, ok := isDefenseText(name); ok {
			p.Team = t
		}
		p.Name = defenseName(p.Team)
	}
	return p, true
}

// afterLink is the text that follows a link up to the next link, line
// break or block: the words the page writes beside that one player.
func afterLink(a *node) string {
	var b strings.Builder
	for n := a.NextSibling; n != nil; n = n.NextSibling {
		if isTag(n, "a") || isTag(n, "br") || isTag(n, "div") {
			break
		}
		b.WriteString(text(n))
		b.WriteByte(' ')
	}
	return collapse(b.String())
}

// injuredReserve says FFPC marks the player in this cell IR: the injury
// designation it writes beside his name (<span class="injuryStatus">IR).
// The capture carries it on James Conner's bench row.
func injuredReserve(cell *node) bool {
	for _, s := range all(cell, tagClass("span", "injuryStatus")) {
		if irLabel.MatchString(Clean(text(s), maxName)) {
			return true
		}
	}
	return false
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
	// Reserve and Taxi are the players in an injured reserve or taxi
	// table, by the table's name (inferred, see tableSlot). A table named
	// for neither adds to Bench.
	Reserve []Player `json:"reserve"`
	Taxi    []Player `json:"taxi"`
}

var (
	weekNum = regexp.MustCompile(`(?i)weekNum=([0-9]{1,2})`)
	// repeaterName is a lineup table's repeater in its controls' ids:
	// "..._rptBench_tdPlayerRole_3" names rptBench.
	repeaterName = regexp.MustCompile(`_(rpt[A-Za-z]+)_`)
)

// Lineup tables the page always has, and the repeater nested in a row
// (the player's news) that is not a table of players.
const (
	repStarting = "rptStartingLineup"
	repBench    = "rptBench"
	repNews     = "rptPlayerNews"
)

// tableSlot is the kind of a lineup table by its repeater's name
// ("rptInjuredReserve", "rptTaxiSquad"). Inferred, not yet seen in a
// capture (2026-10-14): the captured page has only the starting lineup
// and the bench. A table named for neither is rostered, unmarked.
func tableSlot(repeater string) string {
	name := strings.ToUpper(strings.TrimPrefix(repeater, "rpt"))
	switch {
	case strings.Contains(name, "TAXI"):
		return SlotTaxi
	case name == "IR" || strings.Contains(name, "INJURED") || strings.HasPrefix(name, "IR"):
		return SlotReserve
	}
	return SlotOther
}

// otherRepeaters is every repeater on the page that is not the starting
// lineup, the bench or a row's news, in page order: an IR or taxi table.
func otherRepeaters(doc *node) []string {
	var out []string
	seen := map[string]bool{repStarting: true, repBench: true, repNews: true}
	for _, n := range all(doc, func(n *node) bool { return attr(n, "id") != "" }) {
		m := repeaterName.FindStringSubmatch(attr(n, "id"))
		if m == nil || seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		out = append(out, m[1])
	}
	return out
}

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
	starters := lineupTable(doc, repStarting)
	bench := lineupTable(doc, repBench)
	if starters == nil && bench == nil {
		return Lineup{}, ErrNotThisPage
	}
	for _, row := range starters {
		l.Starters, l.Slots = append(l.Starters, row.player), append(l.Slots, row.slot)
	}
	for _, row := range bench {
		l.Bench = append(l.Bench, row.player)
	}
	for _, rep := range otherRepeaters(doc) {
		for _, row := range lineupTable(doc, rep) {
			switch tableSlot(rep) {
			case SlotTaxi:
				l.Taxi = append(l.Taxi, row.player)
			case SlotReserve:
				l.Reserve = append(l.Reserve, row.player)
			default:
				l.Bench = append(l.Bench, row.player)
			}
		}
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
	p := Player{ID: id, Name: name, Position: pos, Team: teamCode, IR: injuredReserve(row[pi])}
	if pos == DEF {
		if t, ok := isDefenseText(text(a)); ok {
			p.Team = t
		}
		p.Name = defenseName(p.Team)
	}
	slot, _ := cellText(row, col, "slot")
	return lineupRow{slot: Clean(slot, 8), player: p}, true
}
