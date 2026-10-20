package ffpc

import (
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// Rules is a league's settings as its rules pages state them: the
// lineup, the roster size, the team count and the scoring. The scoring
// is in Sleeper's key names (pass_yd, rec, bonus_rec_te), the names the
// 21-key scoring map reads; every scoring line not put in a key is kept
// in Unread in the page's own words, so nothing is silently lost.
type Rules struct {
	Teams       int                `json:"teams"`
	RosterSpots int                `json:"roster_spots"`
	Rounds      int                `json:"rounds"`
	Snake       bool               `json:"snake"`
	Lineup      LineupCounts       `json:"lineup"`
	HasLineup   bool               `json:"has_lineup"`
	Scoring     map[string]float64 `json:"scoring"`
	Unread      []string           `json:"unread"`
	// OfficialRules is the official rules page the league's rules page
	// links to, where FFPC states the scoring in full; empty when none.
	OfficialRules string `json:"official_rules"`
	// PlayoffStartWeek is the league's first playoff week from the rules'
	// Duration row ("League Playoffs Weeks 13-14", else the week after
	// "Regular season Weeks 1-12"), 0 when the row does not say.
	PlayoffStartWeek int `json:"playoff_start_week,omitempty"`
	// PlayoffLastWeek is the league playoffs' last week from the same row
	// ("League Playoffs Weeks 13-14"), 0 when the row gives no range.
	PlayoffLastWeek int `json:"playoff_last_week,omitempty"`
	// Seeds is how the rules seed the league playoffs, seed by seed
	// (SeedRecord or SeedPoints), from the "Seed 1) Team with best regular
	// season Record" lines; none when the page states no seeding.
	Seeds []string `json:"seeds,omitempty"`
}

// How a playoff seed is earned, as the rules state it.
const (
	SeedRecord = "record"
	SeedPoints = "points"
)

var (
	playoffWeeks = regexp.MustCompile(`(?i)playoffs? weeks? ([0-9]{1,2})`)
	regularWeeks = regexp.MustCompile(`(?i)regular season weeks? [0-9]{1,2}-([0-9]{1,2})`)
	playoffSpan  = regexp.MustCompile(`(?i)league playoffs? weeks? ([0-9]{1,2})-([0-9]{1,2})`)
	seedLine     = regexp.MustCompile(`Seed ([0-9]{1,2})\)`)
)

// seedsOf reads the seeding lines of a rules cell: each "Seed N)" and
// the words up to the next, by record or by points, in seed order. A
// line that says neither, or seeds out of order, reads as no seeding.
func seedsOf(cell string) []string {
	at := seedLine.FindAllStringSubmatchIndex(cell, -1)
	var out []string
	for i, m := range at {
		n, _ := strconv.Atoi(cell[m[2]:m[3]])
		end := len(cell)
		if i+1 < len(at) {
			end = at[i+1][0]
		}
		words := strings.ToLower(cell[m[1]:end])
		switch {
		case n != i+1:
			return nil
		case strings.Contains(words, "record"):
			out = append(out, SeedRecord)
		case strings.Contains(words, "point"):
			out = append(out, SeedPoints)
		default:
			return nil
		}
	}
	return out
}

// playoffEnd reads the Duration row's last league playoff week.
func playoffEnd(duration string) int {
	if m := playoffSpan.FindStringSubmatch(duration); m != nil {
		n, _ := strconv.Atoi(m[2])
		return boundedWeek(n)
	}
	return 0
}

// playoffStart reads the Duration row's first playoff week.
func playoffStart(duration string) int {
	if m := playoffWeeks.FindStringSubmatch(duration); m != nil {
		n, _ := strconv.Atoi(m[1])
		return boundedWeek(n)
	}
	if m := regularWeeks.FindStringSubmatch(duration); m != nil {
		n, _ := strconv.Atoi(m[1])
		return boundedWeek(n + 1)
	}
	return 0
}

// boundedWeek is a week within a season's schedule, else 0.
func boundedWeek(n int) int {
	if n < 1 || n > MaxWeeks {
		return 0
	}
	return n
}

// LineupCounts is a starting lineup by slot.
type LineupCounts struct {
	QB        int `json:"qb"`
	RB        int `json:"rb"`
	WR        int `json:"wr"`
	TE        int `json:"te"`
	K         int `json:"k"`
	DEF       int `json:"def"`
	Flex      int `json:"flex"`
	SuperFlex int `json:"super_flex"`
	// Other names slots the rooms do not follow, in the page's words.
	Other []string `json:"other"`
}

// Starters is how many players start.
func (l LineupCounts) Starters() int {
	return l.QB + l.RB + l.WR + l.TE + l.K + l.DEF + l.Flex + l.SuperFlex
}

var (
	lineupPart  = regexp.MustCompile(`(?i)([0-9]{1,2})\s*-\s*([A-Za-z/]+)`)
	parenNumber = regexp.MustCompile(`\(([0-9]{1,3})\)`)
	leadNumber  = regexp.MustCompile(`^([0-9]{1,3})\b`)
	officialRef = regexp.MustCompile(`^https://myffpc\.com/cms/public/play/[a-z0-9-]{1,80}-official-rules/?$`)
)

// ParseRules reads a league's rules page and, when the page states it,
// its scoring. A page that only points at the official rules leaves
// Scoring empty and names the official rules page in OfficialRules; read
// that page with ParseScoring.
func ParseRules(page []byte) (Rules, error) {
	doc, err := parse(page)
	if err != nil {
		return Rules{}, err
	}
	r := Rules{Scoring: map[string]float64{}}
	found := false
	for _, tr := range all(doc, tag("tr")) {
		row := cells(tr)
		if len(row) < 2 {
			continue
		}
		value := text(row[1])
		found = ruleRow(&r, strings.ToLower(text(row[0])), value) || found
		if seeds := seedsOf(value); len(seeds) > 0 && len(r.Seeds) == 0 {
			r.Seeds = seeds
		}
	}
	for _, a := range all(doc, tag("a")) {
		if href := strings.TrimSpace(attr(a, "href")); officialRef.MatchString(href) {
			r.OfficialRules = href
			break
		}
	}
	scoring, unread := scoringLines(blockLines(doc))
	if len(scoring) > 0 {
		r.Scoring, r.Unread = scoring, unread
	}
	if !found && len(scoring) == 0 {
		return Rules{}, ErrNotThisPage
	}
	return r, nil
}

// ruleRow reads one label and value of the rules table.
func ruleRow(r *Rules, label, value string) bool {
	switch {
	case strings.HasPrefix(label, "number of teams"):
		r.Teams, _ = strconv.Atoi(strings.TrimSpace(value))
	case strings.HasPrefix(label, "roster requirement"):
		if m := parenNumber.FindStringSubmatch(value); m != nil {
			r.RosterSpots, _ = strconv.Atoi(m[1])
		}
	case strings.HasPrefix(label, "draft type"):
		if m := leadNumber.FindStringSubmatch(value); m != nil {
			r.Rounds, _ = strconv.Atoi(m[1])
		}
		r.Snake = strings.Contains(strings.ToLower(value), "snake") || strings.Contains(strings.ToLower(value), "serpentine")
	case strings.HasPrefix(label, "starting lineup"):
		r.Lineup, r.HasLineup = lineupOf(value), true
	case strings.HasPrefix(label, "duration"):
		r.PlayoffStartWeek, r.PlayoffLastWeek = playoffStart(value), playoffEnd(value)
	default:
		return false
	}
	return true
}

// lineupOf reads "1-QB, 2-RB, 2-WR, 1-TE, 2-Flex, 1-K, 1-D".
func lineupOf(s string) LineupCounts {
	var l LineupCounts
	for _, m := range lineupPart.FindAllStringSubmatch(s, -1) {
		n, _ := strconv.Atoi(m[1])
		switch strings.ToUpper(m[2]) {
		case QB:
			l.QB += n
		case RB:
			l.RB += n
		case WR:
			l.WR += n
		case TE:
			l.TE += n
		case "K", "PK":
			l.K += n
		case "D", "DST", "DEF", "D/ST":
			l.DEF += n
		case "FLEX":
			l.Flex += n
		case "SUPERFLEX", "SF", "SFLEX":
			l.SuperFlex += n
		default:
			l.Other = append(l.Other, Clean(m[0], 20))
		}
	}
	return l
}

// ParseScoring reads the scoring a rules page states in prose, the
// official rules page most often.
func ParseScoring(page []byte) (map[string]float64, []string, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, nil, err
	}
	scoring, unread := scoringLines(blockLines(doc))
	if len(scoring) == 0 {
		return nil, nil, ErrNotThisPage
	}
	return scoring, unread, nil
}

// blockLines is the page's text, one line per block element.
func blockLines(doc *node) []string {
	var lines []string
	var cur strings.Builder
	flush := func() {
		if s := collapse(cur.String()); s != "" {
			lines = append(lines, s)
		}
		cur.Reset()
	}
	var walk func(*node)
	walk = func(n *node) {
		if n.Type == html.ElementNode && (n.Data == "script" || n.Data == "style") {
			return
		}
		block := n.Type == html.ElementNode && blockTags[n.Data]
		if block {
			flush()
		}
		if n.Type == html.TextNode {
			cur.WriteString(n.Data)
			cur.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if block {
			flush()
		}
	}
	walk(doc)
	flush()
	return lines
}

var blockTags = map[string]bool{
	"p": true, "div": true, "li": true, "tr": true, "td": true, "th": true, "br": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "ul": true, "ol": true, "table": true,
}
