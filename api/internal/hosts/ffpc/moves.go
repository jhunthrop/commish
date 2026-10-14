package ffpc

import (
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// Move is one completed roster move as the league home's transactions
// panel lists it. Its players carry no ids: the panel names them only.
type Move struct {
	At     time.Time `json:"at"`
	TeamID int       `json:"team_id"`
	Adds   []Player  `json:"adds"`
	Drops  []Player  `json:"drops"`
	// Trade says the page called it a trade.
	Trade bool `json:"trade"`
}

// MaxMoves bounds the moves one page gives.
const MaxMoves = 100

var (
	moveLine   = regexp.MustCompile(`^(Added|Add|Drop Player|Dropped|Drop|Traded|Trade)\s+(.+?)\s+\(([A-Z/]{1,4})\)$`)
	moveLayout = "1/2/2006 3:04:05 PM"
)

// ParseMoves reads the transactions panel of the league home page (the
// transactions page itself lists nothing until a report is asked for).
func ParseMoves(page []byte) ([]Move, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	var out []Move
	found := false
	for _, a := range all(doc, idContains("rptLeagueTransactions_hlnkTeam")) {
		found = true
		tr := a.Parent
		for tr != nil && !isTag(tr, "tr") {
			tr = tr.Parent
		}
		if tr == nil {
			continue
		}
		if mv, ok := moveRow(cells(tr), teamOf(attr(a, "href"))); ok && len(out) < MaxMoves {
			out = append(out, mv)
		}
	}
	if !found && first(doc, idContains("rptLeagueTransactions")) == nil && !strings.Contains(text(doc), "Transactions") {
		return nil, ErrNotThisPage
	}
	return out, nil
}

func moveRow(row []*node, teamID int) (Move, bool) {
	if len(row) < 4 || teamID == 0 {
		return Move{}, false
	}
	at, err := time.ParseInLocation(moveLayout, text(row[0]), eastern())
	if err != nil {
		return Move{}, false
	}
	mv := Move{At: at, TeamID: teamID}
	for _, line := range strings.Split(lineText(row[3]), "\n") {
		m := moveLine.FindStringSubmatch(Clean(line, maxText))
		if m == nil {
			continue
		}
		pos, ok := position(m[3])
		if !ok {
			continue
		}
		name, teamCode := lastFirst(m[2])
		p := Player{Name: name, Position: pos, Team: teamCode}
		if pos == DEF {
			p.Name = defenseName(teamCode)
		}
		switch m[1] {
		case "Added", "Add":
			mv.Adds = append(mv.Adds, p)
		case "Traded", "Trade":
			mv.Trade = true
			mv.Adds = append(mv.Adds, p)
		default:
			mv.Drops = append(mv.Drops, p)
		}
	}
	return mv, len(mv.Adds)+len(mv.Drops) > 0
}

// lineText is a cell's text with its line breaks kept, one line each.
func lineText(n *node) string {
	var lines []string
	var cur strings.Builder
	var walk func(*node)
	walk = func(c *node) {
		if isTag(c, "br") {
			lines = append(lines, cur.String())
			cur.Reset()
		}
		if c.Type == html.TextNode {
			cur.WriteString(c.Data)
		}
		for k := c.FirstChild; k != nil; k = k.NextSibling {
			walk(k)
		}
	}
	walk(n)
	lines = append(lines, cur.String())
	return strings.Join(lines, "\n")
}
