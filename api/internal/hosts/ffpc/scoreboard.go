package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// Scoreboard is the live scoring page as the member sees it: the week it
// is set to and the member's own team's total so far, with how many of
// their starters are playing and yet to play. In an all-play week it is
// where the member's score comes from (the schedule lists no game).
type Scoreboard struct {
	Week      int     `json:"week"`
	Team      string  `json:"team"`
	Points    float64 `json:"points"`
	InPlay    int     `json:"in_play"`
	YetToPlay int     `json:"yet_to_play"`
}

// currentWeek is the week picker's current option: "Week 6 (Current)".
var currentWeek = regexp.MustCompile(`^Week ([0-9]{1,2}) \(Current\)$`)

// Labels of the member's team card, as the page starts them (a comment
// inside the label can follow the words).
const (
	labelInPlay    = "In Play"
	labelYetToPlay = "Yet To Play"
)

// ParseScoreboard reads the scoring page's week and the member's own
// team card, the first (left) one. The page can say it is "temporarily
// unavailable" and still carry the card, so the card is what decides.
func ParseScoreboard(page []byte) (Scoreboard, error) {
	doc, err := parse(page)
	if err != nil {
		return Scoreboard{}, err
	}
	var s Scoreboard
	for _, o := range all(doc, tag("option")) {
		if m := currentWeek.FindStringSubmatch(Clean(text(o), maxName)); m != nil {
			s.Week, _ = strconv.Atoi(m[1])
		}
	}
	card := first(doc, tagClass("div", "team-left"))
	if card == nil || s.Week == 0 {
		return Scoreboard{}, ErrNotThisPage
	}
	name := first(card, tagClass("div", "team-name"))
	clock := first(card, tagClass("div", "clock"))
	if name == nil || clock == nil {
		return Scoreboard{}, ErrNotThisPage
	}
	s.Team = Clean(text(name), maxName)
	points, ok := number(strings.TrimSpace(text(clock)))
	if !ok || s.Team == "" {
		return Scoreboard{}, ErrNotThisPage
	}
	s.Points = points
	for _, tr := range all(card, tag("tr")) {
		tds := cells(tr)
		if len(tds) != 2 {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(text(tds[1])))
		if err != nil {
			continue
		}
		switch label := Clean(text(tds[0]), maxName); {
		case strings.HasPrefix(label, labelInPlay):
			s.InPlay = n
		case strings.HasPrefix(label, labelYetToPlay):
			s.YetToPlay = n
		}
	}
	return s, nil
}
