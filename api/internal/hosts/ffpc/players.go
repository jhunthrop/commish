package ffpc

import (
	"net/url"
	"regexp"
	"strings"
)

// Player is one player as an FFPC page names him. ID is FFPC's own player
// id ("26890", "T0635", "DPATS" for a defense), empty where the page
// names him without one (the transactions list); it is kept for a future
// crosswalk, and until then players are placed on our board by name,
// position and team.
type Player struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position string `json:"position"`
	Team     string `json:"team"`
	// NameCut says the page showed the name cut short (a draft board
	// cell ends a long last name in "..."), so it is matched by its start.
	NameCut bool `json:"name_cut,omitempty"`
}

// Positions as our engine names them.
const (
	QB  = "QB"
	RB  = "RB"
	WR  = "WR"
	TE  = "TE"
	K   = "K"
	DEF = "DEF"
)

// position is FFPC's position code as ours: PK is a kicker, DF, DST and
// D a team defense. Anything else is not a position we follow.
func position(code string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(code)) {
	case QB:
		return QB, true
	case RB:
		return RB, true
	case WR:
		return WR, true
	case TE:
		return TE, true
	case "PK", K:
		return K, true
	case "DF", "DST", "D", DEF:
		return DEF, true
	}
	return "", false
}

var (
	playerIDShape = regexp.MustCompile(`^[A-Za-z0-9]{1,16}$`)
	teamShape     = regexp.MustCompile(`^[A-Z]{2,3}$`)
	maxName       = 80
)

// playerID is the playerID a PlayerProfile link names, trimmed (FFPC
// pads some with a space), or empty.
func playerID(href string) string {
	u, err := url.Parse(strings.TrimSpace(href))
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(u.Query().Get("playerID"))
	if !playerIDShape.MatchString(id) {
		return ""
	}
	return id
}

// team is a team code as FFPC writes it, or empty: "FA" and anything not
// two or three capitals is no team.
func team(code string) string {
	code = strings.Trim(strings.TrimSpace(code), "()@")
	if code == "FA" || !teamShape.MatchString(code) {
		return ""
	}
	return code
}

// lastFirst reads FFPC's "Last, First TEAM" form ("Maye, Drake NE",
// "St. Brown, Amon-Ra DET") into "First Last" and the team. A defense
// ("NE DST") has no comma and reads as its team.
func lastFirst(s string) (name, teamCode string) {
	s = Clean(s, maxText)
	words := strings.Fields(s)
	if n := len(words); n > 1 && team(words[n-1]) != "" {
		teamCode, words = words[n-1], words[:n-1]
	}
	s = strings.Join(words, " ")
	if last, firstName, ok := strings.Cut(s, ","); ok {
		s = strings.TrimSpace(firstName) + " " + strings.TrimSpace(last)
	}
	return Clean(s, maxName), teamCode
}

// defenseName is the name a defense is given: its team and "Defense".
func defenseName(teamCode string) string { return teamCode + " Defense" }

// isDefenseText reports a page's name for a team defense: "NE DST",
// "PIT Team Defense".
func isDefenseText(s string) (string, bool) {
	words := strings.Fields(s)
	if len(words) >= 2 && team(words[0]) != "" {
		rest := strings.ToUpper(strings.Join(words[1:], " "))
		if rest == "DST" || rest == "TEAM DEFENSE" || rest == "DEFENSE" || rest == "D/ST" {
			return words[0], true
		}
	}
	return "", false
}
