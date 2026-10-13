package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// MaxPool bounds the free agents one page lists.
const MaxPool = 200

var poolName = regexp.MustCompile(`^(.+?)\s+\(([A-Z/]{1,4})\)$`)

// ParseFreeAgents reads the free agents page: the unrostered players it
// lists, in its order.
func ParseFreeAgents(page []byte) ([]Player, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	table := first(doc, idSuffix("grdFreeAgents"))
	if table == nil {
		return nil, ErrNotThisPage
	}
	out := []Player{}
	for _, a := range all(table, tag("a")) {
		id := playerID(attr(a, "href"))
		if id == "" || !strings.Contains(attr(a, "href"), "PlayerProfile.aspx") {
			continue
		}
		m := poolName.FindStringSubmatch(Clean(text(a), maxText))
		if m == nil {
			continue
		}
		pos, ok := position(m[2])
		if !ok {
			continue
		}
		name, teamCode := lastFirst(m[1])
		p := Player{ID: id, Name: name, Position: pos, Team: teamCode}
		if pos == DEF {
			if t, ok := isDefenseText(m[1]); ok {
				p.Team = t
			}
			p.Name = defenseName(p.Team)
		}
		if len(out) < MaxPool {
			out = append(out, p)
		}
	}
	return out, nil
}

// MyLeague is one of the member's leagues on the My Teams page.
type MyLeague struct {
	LeagueID string  `json:"league_id"`
	Name     string  `json:"name"`
	TeamName string  `json:"team_name"`
	Record   string  `json:"record"`
	Points   float64 `json:"points"`
	Place    int     `json:"place"`
	// Target is the page control that opens the league (a postback, the
	// way the page's own link does), never shown to anyone.
	Target string `json:"-"`
}

var (
	leagueIDCell = regexp.MustCompile(`^[0-9]{1,12}$`)
	postbackArg  = regexp.MustCompile(`__doPostBack\('([A-Za-z0-9$_]{1,200})'`)
)

// ParseMyTeams reads the My Teams page: each league whose draft is done,
// with the member's team in it.
func ParseMyTeams(page []byte) ([]MyLeague, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	var out []MyLeague
	for _, table := range all(doc, tagClass("table", "myTeams")) {
		for _, tr := range rows(table) {
			if l, ok := myLeagueRow(tr); ok {
				out = append(out, l)
			}
		}
	}
	if out == nil && first(doc, tagClass("table", "myTeams")) == nil {
		return nil, ErrNotThisPage
	}
	return out, nil
}

func myLeagueRow(tr *node) (MyLeague, bool) {
	row := cells(tr)
	if len(row) < 7 || !leagueIDCell.MatchString(text(row[0])) {
		return MyLeague{}, false
	}
	l := MyLeague{LeagueID: text(row[0])}
	if a := first(tr, idContains("lnkLeagueName_")); a != nil {
		l.Name = Clean(text(a), maxName)
		if m := postbackArg.FindStringSubmatch(attr(a, "href")); m != nil {
			l.Target = m[1]
		}
	}
	if a := first(tr, idContains("lnkTeamName_")); a != nil {
		l.TeamName = Clean(text(a), maxName)
	}
	l.Record = Clean(text(row[4]), 20)
	l.Points, _ = number(text(row[5]))
	if a := first(tr, idContains("lnkPlace_")); a != nil {
		l.Place, _ = strconv.Atoi(strings.TrimSpace(text(a)))
	} else {
		l.Place, _ = strconv.Atoi(strings.TrimSpace(text(row[6])))
	}
	return l, l.Name != ""
}
