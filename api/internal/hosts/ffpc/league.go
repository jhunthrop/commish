package ffpc

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // FFPC states times in Eastern; the image may carry no zone files
)

// Errors a caller tells apart.
var (
	// ErrNotThisPage is HTML that is not the page asked about: a sign-in
	// page, an error page, another page altogether.
	ErrNotThisPage = errors.New("ffpc: not the expected page")
	// ErrNotAvailable is a page FFPC says is not available now (the draft
	// report card before the NFL draft, the scoreboard when it is down).
	ErrNotAvailable = errors.New("ffpc: page not available")
)

// MaxTeams bounds a league.
const MaxTeams = 32

// Banner is the league banner every league page carries above its
// content: the league, its season and the team the page is for (the
// member's own, by the ltuid in the address).
type Banner struct {
	LeagueID   string `json:"league_id"`
	LeagueName string `json:"league_name"`
	LeagueType string `json:"league_type"`
	Season     int    `json:"season"`
	TeamID     int    `json:"team_id"`
	TeamName   string `json:"team_name"`
}

var (
	leagueIDLine = regexp.MustCompile(`^League ID: ([0-9]{1,12})$`)
	teamIDLine   = regexp.MustCompile(`^Team ID: ([0-9]{1,2})$`)
	typeLine     = regexp.MustCompile(`^League Type Description: (.+)$`)
)

// ParseBanner reads the league banner (LeagueHome and the pages that
// share its banner).
func ParseBanner(page []byte) (Banner, error) {
	doc, err := parse(page)
	if err != nil {
		return Banner{}, err
	}
	return banner(doc)
}

func banner(doc *node) (Banner, error) {
	var b Banner
	for _, d := range all(doc, tag("div")) {
		line := ownText(d)
		if m := leagueIDLine.FindStringSubmatch(line); m != nil {
			b.LeagueID = m[1]
		}
		if m := teamIDLine.FindStringSubmatch(line); m != nil {
			b.TeamID, _ = strconv.Atoi(m[1])
		}
		if m := typeLine.FindStringSubmatch(line); m != nil {
			b.LeagueType = Clean(m[1], maxName)
		}
	}
	if b.LeagueID == "" || b.TeamID < 1 || b.TeamID > MaxTeams {
		return Banner{}, ErrNotThisPage
	}
	for _, h := range all(doc, tag("h4")) {
		if p := h.Parent; p != nil && hasClass(p, "league-name") {
			b.LeagueName = Clean(text(h), maxName)
			break
		}
	}
	if h := first(doc, tagClass("h2", "leagueBannerTeamName")); h != nil {
		b.TeamName = Clean(text(h), maxName)
	}
	if sel := first(doc, idSuffix("ddlViewingSeason")); sel != nil {
		b.Season = selectedSeason(sel)
	}
	return b, nil
}

// selectedSeason is the season the banner's select shows: the selected
// option, or the first (the current season) when none is marked.
func selectedSeason(sel *node) int {
	opts := children(sel, "option")
	for _, o := range opts {
		if attr(o, "selected") != "" || hasAttr(o, "selected") {
			return seasonOf(attr(o, "value"))
		}
	}
	if len(opts) > 0 {
		return seasonOf(attr(opts[0], "value"))
	}
	return 0
}

func hasAttr(n *node, key string) bool {
	for _, a := range n.Attr {
		if a.Key == key {
			return true
		}
	}
	return false
}

func seasonOf(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 2000 || n > 2100 {
		return 0
	}
	return n
}

// teamOf is the viewingTeam a team link names, 0 when it names none.
func teamOf(href string) int {
	u, err := url.Parse(strings.TrimSpace(href))
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(u.Query().Get("viewingTeam"))
	if err != nil || n < 1 || n > MaxTeams {
		return 0
	}
	return n
}

// number reads "1,234.50", "$1,000" or "-2" as a figure.
func number(s string) (float64, bool) {
	s = strings.NewReplacer(",", "", "$", "", "%", "").Replace(strings.TrimSpace(s))
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || v != v || v > 1e6 || v < -1e6 {
		return 0, false
	}
	return v, true
}

// eastern is FFPC's clock: its pages give times without a zone, in ET.
func eastern() *time.Location {
	if loc, err := time.LoadLocation("America/New_York"); err == nil {
		return loc
	}
	return time.FixedZone("ET", -5*3600)
}
