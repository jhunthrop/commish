package ffpc

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Game is one head-to-head game of a week: the away team at the home
// team, and each side's points as the page shows them.
type Game struct {
	Away       int     `json:"away"`
	Home       int     `json:"home"`
	AwayPoints float64 `json:"away_points"`
	HomePoints float64 `json:"home_points"`
}

// Week is one week of the schedule.
type Week struct {
	Number int `json:"number"`
	// Starts and Ends are the week's dates as the page gives them.
	Starts time.Time `json:"starts"`
	Ends   time.Time `json:"ends"`
	// AllPlay is a week every team plays every other (no games listed).
	AllPlay bool   `json:"all_play"`
	Games   []Game `json:"games"`
}

var (
	weekHeading = regexp.MustCompile(`^Week ([0-9]{1,2}) - ([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}) - ([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})(.*)$`)
	scorePair   = regexp.MustCompile(`^(-?[0-9]+(?:\.[0-9]+)?) - (-?[0-9]+(?:\.[0-9]+)?)$`)
)

// MaxWeeks bounds a season's schedule.
const MaxWeeks = 22

// ParseSchedule reads the schedule and results page: every week with its
// games and their scores.
func ParseSchedule(page []byte) ([]Week, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	var out []Week
	for _, card := range all(doc, tagClass("div", "card")) {
		h := first(card, tag("h3"))
		if h == nil {
			continue
		}
		m := weekHeading.FindStringSubmatch(text(h))
		if m == nil {
			continue
		}
		w := Week{AllPlay: strings.Contains(strings.ToLower(m[4]), "all play")}
		w.Number, _ = strconv.Atoi(m[1])
		w.Starts, _ = time.ParseInLocation("1/2/2006", m[2], eastern())
		w.Ends, _ = time.ParseInLocation("1/2/2006", m[3], eastern())
		if w.Number < 1 || w.Number > MaxWeeks {
			continue
		}
		for _, tr := range all(card, func(n *node) bool { return isTag(n, "tr") && strings.Contains(attr(n, "id"), "trMatchupRow") }) {
			if g, ok := gameRow(cells(tr)); ok {
				w.Games = append(w.Games, g)
			}
		}
		out = append(out, w)
	}
	if len(out) == 0 || len(out) > MaxWeeks {
		return nil, ErrNotThisPage
	}
	return out, nil
}

func gameRow(row []*node) (Game, bool) {
	if len(row) < 2 {
		return Game{}, false
	}
	links := all(row[0], tag("a"))
	if len(links) != 2 {
		return Game{}, false
	}
	g := Game{Away: teamOf(attr(links[0], "href")), Home: teamOf(attr(links[1], "href"))}
	m := scorePair.FindStringSubmatch(text(row[1]))
	if g.Away == 0 || g.Home == 0 || m == nil {
		return Game{}, false
	}
	g.AwayPoints, _ = number(m[1])
	g.HomePoints, _ = number(m[2])
	return g, true
}

// WeekOf is the schedule's week whose dates hold the moment, 0 when none
// does.
func WeekOf(weeks []Week, at time.Time) int {
	for _, w := range weeks {
		if !at.Before(w.Starts) && at.Before(w.Ends.AddDate(0, 0, 1)) {
			return w.Number
		}
	}
	return 0
}
