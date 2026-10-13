package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// Draft is a draft as the draft board shows it, live or complete: the
// slots and their teams, the member's own slot, and every pick made.
type Draft struct {
	Teams     int      `json:"teams"`
	Rounds    int      `json:"rounds"`
	SlotNames []string `json:"slot_names"`
	// MySlot is the member's own slot, from the picks the board marks as
	// theirs; 0 before they have picked.
	MySlot   int    `json:"my_slot"`
	Complete bool   `json:"complete"`
	Picks    []Pick `json:"picks"`
}

// Pick is one pick on the board.
type Pick struct {
	Number int    `json:"number"`
	Round  int    `json:"round"`
	Slot   int    `json:"slot"`
	Player Player `json:"player"`
	// Auto says the system made the pick (the board's asterisk).
	Auto bool `json:"auto"`
	Mine bool `json:"mine"`
}

// Bounds a draft board is held to.
const (
	MaxRounds = 50
	MaxPicks  = MaxTeams * MaxRounds
)

var (
	pickCellID   = regexp.MustCompile(`^tdPickCell_([0-9]{1,4})$`)
	pickPosition = regexp.MustCompile(`^draftBoard([A-Z]{1,3})$`)
	posTeam      = regexp.MustCompile(`^([A-Z]{1,3}) \(([A-Z]{2,3}|FA)\)$`)
)

// ParseDraftBoard reads the draft board: the header row's slots, then
// each pick cell. A cell carries FFPC's player id only when the live page
// has it (the draftSpotCellPID attribute); a saved copy may not.
func ParseDraftBoard(page []byte) (Draft, error) {
	doc, err := parse(page)
	if err != nil {
		return Draft{}, err
	}
	board := first(doc, func(n *node) bool { return isTag(n, "table") && attr(n, "id") == "draft-board" })
	if board == nil {
		return Draft{}, ErrNotThisPage
	}
	var d Draft
	trs := rows(board)
	if len(trs) > 0 {
		for _, th := range cells(trs[0]) {
			if hasClass(th, "user") {
				name := ""
				if n := first(th, tagClass("div", "name")); n != nil {
					name = Clean(text(n), maxName)
				}
				d.SlotNames = append(d.SlotNames, name)
			}
		}
	}
	d.Teams = len(d.SlotNames)
	if d.Teams < 2 || d.Teams > MaxTeams {
		return Draft{}, ErrNotThisPage
	}
	for _, tr := range trs[1:] {
		if first(tr, tagClass("td", "draftBoardRound")) != nil {
			d.Rounds++
		}
	}
	for _, td := range all(board, func(n *node) bool { return isTag(n, "td") && pickCellID.MatchString(attr(n, "id")) }) {
		if p, ok := pickCell(td, d.Teams); ok && len(d.Picks) < MaxPicks {
			d.Picks = append(d.Picks, p)
			if p.Mine && d.MySlot == 0 {
				d.MySlot = p.Slot
			}
		}
	}
	d.Complete = strings.Contains(strings.ToUpper(text(doc)), "YOUR DRAFT IS COMPLETE") && len(d.Picks) == d.Teams*d.Rounds
	return d, nil
}

// pickCell reads one made pick, false for a cell still open.
func pickCell(td *node, teams int) (Pick, bool) {
	number, _ := strconv.Atoi(pickCellID.FindStringSubmatch(attr(td, "id"))[1])
	var p Pick
	pos := ""
	for _, c := range strings.Fields(attr(td, "class")) {
		if m := pickPosition.FindStringSubmatch(c); m != nil {
			pos = m[1]
		}
		if c == "user-pick" {
			p.Mine = true
		}
	}
	posCode, ok := position(pos)
	if !ok || number < 1 || number > MaxPicks {
		return Pick{}, false
	}
	firstName, lastName := "", ""
	if n := first(td, tagClass("div", "first")); n != nil {
		firstName = text(n)
	}
	if n := first(td, tagClass("div", "last")); n != nil {
		lastName = text(n)
	}
	if strings.HasPrefix(firstName, "*") {
		p.Auto, firstName = true, strings.TrimPrefix(firstName, "*")
	}
	p.Number = number
	p.Round = (number-1)/teams + 1
	p.Slot = snakeSlot(number, teams)
	p.Player = Player{ID: strings.TrimSpace(attr(td, "draftspotcellpid")), Position: posCode}
	if !playerIDShape.MatchString(p.Player.ID) {
		p.Player.ID = ""
	}
	bottom := first(td, tagClass("table", "draftCellBottom"))
	if bottom != nil {
		for _, cell := range all(bottom, tag("td")) {
			if m := posTeam.FindStringSubmatch(text(cell)); m != nil {
				p.Player.Team = team(m[2])
			}
		}
	}
	if posCode == DEF {
		if dt := first(td, tagClass("div", "draft-team")); dt != nil {
			p.Player.Team = team(ownText(dt))
		}
		p.Player.Name = defenseName(p.Player.Team)
	} else {
		if cut, ok := strings.CutSuffix(strings.TrimSpace(lastName), "..."); ok {
			lastName, p.Player.NameCut = cut, true
		}
		p.Player.Name = Clean(strings.TrimSpace(firstName)+" "+strings.TrimSpace(lastName), maxName)
	}
	return p, p.Player.Name != ""
}

// snakeSlot is the slot whose turn pick number is in a snake draft.
func snakeSlot(number, teams int) int {
	round := (number-1)/teams + 1
	inRound := (number-1)%teams + 1
	if round%2 == 0 {
		return teams - inRound + 1
	}
	return inRound
}

// IsDraftReportUnavailable reports a draft report card page that says it
// is not available yet (before the NFL draft each spring).
func IsDraftReportUnavailable(page []byte) bool {
	doc, err := parse(page)
	if err != nil {
		return false
	}
	return first(doc, tagClass("div", "error-message")) != nil
}

// IsUnavailable reports a page that says it is temporarily unavailable
// (the live scoring page, at times).
func IsUnavailable(page []byte) bool {
	doc, err := parse(page)
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(text(doc)), "temporarily unavailable")
}
