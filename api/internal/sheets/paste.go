package sheets

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/jhunthrop/commish/api/internal/accents"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A names list is a pasted ranking, one player a line in the drafter's
// order, the way people copy one out of anywhere:
//
//	1. Puka Nacua
//	Ja'Marr Chase, WR
//	Bijan Robinson (RB, ATL)
//	Bills D/ST
//
// This is web/src/lib/sheet/paste.ts, rule for rule (shared/fixtures/
// parity/sheet.json holds both to the same reads). A name is matched to a
// player on our board only when it is unmistakable: the same name once
// case, periods, apostrophes, hyphens and a Jr., Sr. or numeral suffix
// are set aside, and, when two players share it, the position given on the
// line. Anything else is skipped with its line and reason, never guessed,
// because attaching one man's row to another is the one mistake an import
// cannot make.

const (
	defensePosition = "DST"

	reasonNoPlayer    = "No player on our board has this name"
	reasonTwoPlayers  = "Two players share this name. Add his position after a comma"
	reasonRepeat      = "This player is already on an earlier line"
	reasonSharedCity  = "Two clubs share this city. Write the club, like %s"
	reasonSheetIsFull = "A sheet holds at most %d players"
)

var (
	leadingRank    = regexp.MustCompile(`^\s*\d+\s*[.)\-:]?\s+`)
	nameSuffix     = regexp.MustCompile(`\s+(jr|sr|ii|iii|iv|v)$`)
	hintSplit      = regexp.MustCompile(`[,(/|\t]`)
	hintParens     = regexp.MustCompile(`[()]`)
	lineBreak      = regexp.MustCompile(`\r?\n`)
	defenseWord    = regexp.MustCompile(`\s+(dst|def|defense|defence)$`)
	slashedDefense = regexp.MustCompile(`(?i)\bd\s*/\s*st\b`)
	nameDropped    = strings.NewReplacer(".", "", "'", "", "’", "", "`", "")
)

// listPositionAliases are the spellings of a position a list uses beside
// the sheet's own.
func listPositionAliases() map[string]string {
	return map[string]string{"DEF": defensePosition, "D/ST": defensePosition, "PK": "K"}
}

// nameKey is a name as matching reads it.
func nameKey(name string) string {
	s := accents.Strip(strings.ToLower(name))
	s = strings.ReplaceAll(nameDropped.Replace(s), "-", " ")
	s = strings.Join(strings.Fields(s), " ")
	return nameSuffix.ReplaceAllString(s, "")
}

// sheetPlayer is who a board player is, as a sheet row keeps him.
type sheetPlayer struct {
	row      apitypes.SheetRowInput
	position string
	team     string
}

// nameIndex is the board's players by name key, in board order.
type nameIndex map[string][]sheetPlayer

func newNameIndex(raw *boards.Raw) nameIndex {
	index := nameIndex{}
	for _, p := range raw.Players {
		player := playerFor(p)
		for _, key := range keysOf(player) {
			index[key] = append(index[key], player)
		}
	}
	return index
}

func playerFor(p boards.Player) sheetPlayer {
	position := string(p.Position)
	if p.Position == draft.DEF {
		position = defensePosition
	}
	row := apitypes.SheetRowInput{PlayerId: p.ID, Name: p.Name, Position: position}
	if p.Team != "" {
		team := p.Team
		row.Team = &team
	}
	if p.Headshot != "" {
		face := p.Headshot
		row.Headshot = &face
	}
	return sheetPlayer{row: row, position: position, team: p.Team}
}

// keysOf is what a player answers to: a defense also answers to its club,
// its nickname and its city ("BUF", "Bills", "Buffalo"), the ways a
// ranking writes one; anyone else to his name.
func keysOf(p sheetPlayer) []string {
	name := nameKey(p.row.Name)
	if p.position != defensePosition {
		return []string{name}
	}
	words := strings.Split(name, " ")
	candidates := []string{name, words[len(words)-1], strings.Join(words[:len(words)-1], " "), strings.ToLower(p.team)}
	keys := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, key := range candidates {
		if key != "" && !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	return keys
}

// looksLikeCSV is whether the body's first line names player_id, the one
// column a names list never carries. A CSV missing other columns is still
// answered as a CSV, with the header's sentence.
func looksLikeCSV(body string) bool {
	first, _, _ := strings.Cut(strings.TrimLeft(strings.TrimPrefix(body, byteOrderMark), " \t\r\n"), "\n")
	return strings.Contains(strings.ToLower(first), "player_id")
}

type listLine struct {
	name     string
	position string
}

// parsePosition is a position as a list spells it, "" when it is none.
func parsePosition(raw string) string {
	upper := strings.ToUpper(strings.TrimSpace(raw))
	if alias, ok := listPositionAliases()[upper]; ok {
		return alias
	}
	if _, ok := positions()[upper]; ok {
		return upper
	}
	return ""
}

func readListLine(line string) listLine {
	withoutRank := slashedDefense.ReplaceAllString(leadingRank.ReplaceAllString(line, ""), defensePosition)
	parts := hintSplit.Split(withoutRank, -1)
	name := strings.TrimSpace(parts[0])
	for _, hint := range parts[1:] {
		for _, word := range strings.Fields(hintParens.ReplaceAllString(hint, " ")) {
			if position := parsePosition(word); position != "" {
				return listLine{name: name, position: position}
			}
		}
	}
	return listLine{name: name}
}

// matchLine is the player one line names, or why it names none.
func matchLine(line listLine, index nameIndex) (sheetPlayer, string) {
	written := nameKey(line.name)
	position := line.position
	if defenseWord.MatchString(written) {
		position = defensePosition
	}
	fitting := index[defenseWord.ReplaceAllString(written, "")]
	if position != "" {
		fitting = withPosition(fitting, position)
	}
	switch {
	case len(fitting) == 1:
		return fitting[0], ""
	case len(fitting) > 1 && fitting[0].position == defensePosition && fitting[1].position == defensePosition:
		return sheetPlayer{}, fmt.Sprintf(reasonSharedCity, fitting[0].team)
	case len(fitting) > 1:
		return sheetPlayer{}, reasonTwoPlayers
	}
	return sheetPlayer{}, reasonNoPlayer
}

func withPosition(players []sheetPlayer, position string) []sheetPlayer {
	var out []sheetPlayer
	for _, p := range players {
		if p.position == position {
			out = append(out, p)
		}
	}
	return out
}

// ReadList reads a names list against the board, in the order pasted. A
// line that names no one is skipped with its reason.
func ReadList(body string, raw *boards.Raw) ([]apitypes.SheetRowInput, []apitypes.ImportSkip) {
	index := newNameIndex(raw)
	rows := []apitypes.SheetRowInput{}
	skipped := []apitypes.ImportSkip{}
	seen := map[string]bool{}
	for k, text := range lineBreak.Split(body, -1) {
		line := k + 1
		if strings.TrimSpace(text) == "" {
			continue
		}
		match, reason := matchLine(readListLine(text), index)
		switch {
		case reason != "":
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: reason})
		case seen[match.row.PlayerId]:
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: reasonRepeat})
		case len(rows) >= MaxRows:
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: fmt.Sprintf(reasonSheetIsFull, MaxRows)})
		default:
			seen[match.row.PlayerId] = true
			rows = append(rows, match.row)
		}
	}
	return rows, skipped
}
