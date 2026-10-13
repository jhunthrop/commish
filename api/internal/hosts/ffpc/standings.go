package ffpc

import (
	"strconv"
	"strings"
)

// Standing is one team's row on the standings page. A total-points league
// (best ball) shows points only; HasRecord says the page gave a record.
type Standing struct {
	TeamID        int     `json:"team_id"`
	Name          string  `json:"name"`
	Wins          int     `json:"wins"`
	Losses        int     `json:"losses"`
	Ties          int     `json:"ties"`
	HasRecord     bool    `json:"has_record"`
	PointsFor     float64 `json:"points_for"`
	PointsAgainst float64 `json:"points_against"`
}

// columns maps a header row's labels to their cell index.
func columns(header *node) map[string]int {
	out := map[string]int{}
	for i, c := range cells(header) {
		label := strings.ToLower(ownText(c))
		if label == "" {
			label = strings.ToLower(text(c))
		}
		if _, seen := out[label]; !seen {
			out[label] = i
		}
	}
	return out
}

func cellText(row []*node, col map[string]int, label string) (string, bool) {
	i, ok := col[label]
	if !ok || i >= len(row) {
		return "", false
	}
	return text(row[i]), true
}

func cellInt(row []*node, col map[string]int, label string) int {
	s, _ := cellText(row, col, label)
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 || n > 99 {
		return 0
	}
	return n
}

func cellFloat(row []*node, col map[string]int, label string) float64 {
	s, _ := cellText(row, col, label)
	v, _ := number(s)
	return v
}

// ParseStandings reads the standings page: every team in the order the
// page ranks them.
func ParseStandings(page []byte) ([]Standing, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	var out []Standing
	seen := map[int]bool{}
	for _, table := range all(doc, tag("table")) {
		trs := rows(table)
		if len(trs) < 2 {
			continue
		}
		col := columns(trs[0])
		if _, ok := col["team"]; !ok {
			continue
		}
		_, hasWins := col["w"]
		for _, tr := range trs[1:] {
			st, ok := standingRow(tr, col, hasWins)
			if ok && !seen[st.TeamID] {
				seen[st.TeamID] = true
				out = append(out, st)
			}
		}
	}
	if len(out) == 0 || len(out) > MaxTeams {
		return nil, ErrNotThisPage
	}
	return out, nil
}

func standingRow(tr *node, col map[string]int, hasWins bool) (Standing, bool) {
	row := cells(tr)
	i := col["team"]
	if i >= len(row) {
		return Standing{}, false
	}
	link := first(row[i], tag("a"))
	if link == nil {
		return Standing{}, false
	}
	id := teamOf(attr(link, "href"))
	if id == 0 {
		return Standing{}, false
	}
	st := Standing{TeamID: id, Name: Clean(text(link), maxName), HasRecord: hasWins}
	if hasWins {
		st.Wins, st.Losses, st.Ties = cellInt(row, col, "w"), cellInt(row, col, "l"), cellInt(row, col, "t")
	}
	st.PointsFor = cellFloat(row, col, "points")
	st.PointsAgainst = cellFloat(row, col, "pts against")
	return st, true
}

// Owner is a team's owner as the owners page names them.
type Owner struct {
	Team  string `json:"team"`
	Owner string `json:"owner"`
}

// ParseOwners reads the owners page: each team's name and its owner's
// name. The page gives no team ids, so callers join on the team name.
// The owner's email column is never read.
func ParseOwners(page []byte) ([]Owner, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	var out []Owner
	for _, table := range all(doc, tag("table")) {
		trs := rows(table)
		if len(trs) < 2 {
			continue
		}
		col := columns(trs[0])
		ti, okT := col["team"]
		oi, okO := col["owner name"]
		if !okT || !okO {
			continue
		}
		for _, tr := range trs[1:] {
			row := cells(tr)
			if ti >= len(row) || oi >= len(row) {
				continue
			}
			t, o := Clean(text(row[ti]), maxName), Clean(ownText(row[oi]), maxName)
			if t == "" {
				continue
			}
			// A team with a co-owner has a row each; they read as one.
			if n := len(out); n > 0 && out[n-1].Team == t {
				out[n-1].Owner = Clean(out[n-1].Owner+" and "+o, maxName)
				continue
			}
			out = append(out, Owner{Team: t, Owner: o})
		}
	}
	if len(out) == 0 || len(out) > MaxTeams {
		return nil, ErrNotThisPage
	}
	return out, nil
}
