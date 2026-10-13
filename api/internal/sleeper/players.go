package sleeper

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Sleeper's player directory (GET /players/nfl) is about 15 MB and the
// host asks that it be read at most once a day; the caller keeps it.
const maxPlayersBody = 40 << 20

// maxDirectory bounds the fantasy players kept from the directory.
const maxDirectory = 20000

// Player is one fantasy player in Sleeper's directory, checked. Only the
// positions a fantasy lineup starts are kept.
type Player struct {
	ID       string
	Name     string
	Position string
	Team     string
	// ESPNID is the player's ESPN id, empty when Sleeper has none.
	ESPNID string
}

type wirePlayer struct {
	PlayerID  string          `json:"player_id"`
	FirstName string          `json:"first_name"`
	LastName  string          `json:"last_name"`
	FullName  string          `json:"full_name"`
	Position  string          `json:"position"`
	Team      *string         `json:"team"`
	ESPNID    json.RawMessage `json:"espn_id"`
}

func fantasyPositions() map[string]bool {
	return map[string]bool{"QB": true, "RB": true, "WR": true, "TE": true, "K": true, "DEF": true}
}

// Players reads the host's whole player directory.
func (c *Client) Players(ctx context.Context) ([]Player, error) {
	var w map[string]wirePlayer
	long := *c.HTTP
	long.Timeout = PlayersTimeout
	if err := c.getWith(ctx, &long, "/players/nfl", maxPlayersBody, &w); err != nil {
		return nil, err
	}
	return validatePlayers(w)
}

// PlayersTimeout bounds the directory read, about 15 MB, where every
// other read has Timeout.
const PlayersTimeout = 45 * time.Second

// DecodePlayers checks a recorded directory answer.
func DecodePlayers(body []byte) ([]Player, error) {
	var w map[string]wirePlayer
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validatePlayers(w)
}

func validatePlayers(w map[string]wirePlayer) ([]Player, error) {
	out := make([]Player, 0, len(w)/4)
	for key, p := range w {
		if !fantasyPositions()[p.Position] || !playerIDPattern.MatchString(key) || p.PlayerID != key {
			continue
		}
		name := strings.TrimSpace(p.FirstName + " " + p.LastName)
		if p.FullName != "" {
			name = p.FullName
		}
		pl := Player{ID: key, Name: cleanText(name, maxNameLen), Position: p.Position, ESPNID: espnID(p.ESPNID)}
		if p.Team != nil && len(*p.Team) <= maxTextLen {
			pl.Team = strings.ToUpper(*p.Team)
		}
		if pl.Name == "" {
			continue
		}
		out = append(out, pl)
		if len(out) > maxDirectory {
			return nil, malformed("over %d fantasy players", maxDirectory)
		}
	}
	return out, nil
}

// espnID reads Sleeper's espn_id, a number or a string, as digits.
func espnID(raw json.RawMessage) string {
	var n json.Number
	if json.Unmarshal(raw, &n) != nil {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return ""
		}
		n = json.Number(s)
	}
	v, err := strconv.ParseInt(n.String(), 10, 64)
	if err != nil || v <= 0 {
		return ""
	}
	return strconv.FormatInt(v, 10)
}

// ErrNotALeagueLink is pasted text that names no Sleeper league.
var ErrNotALeagueLink = errors.New("sleeper: not a league link")

// ParseLeagueLink reads the league id out of what a drafter pasted: the
// id itself, or a link such as https://sleeper.com/leagues/1382163311038038016/team.
// Only the id leaves this function; the link is never fetched.
func ParseLeagueLink(pasted string) (string, error) {
	s := strings.TrimSpace(pasted)
	if s == "" || len(s) > maxLinkLen {
		return "", ErrNotALeagueLink
	}
	if ValidID(s) {
		return s, nil
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || !hosts()[strings.ToLower(u.Hostname())] {
		return "", ErrNotALeagueLink
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i, part := range parts {
		if (part == "leagues" || part == "league") && i+1 < len(parts) && ValidID(parts[i+1]) {
			return parts[i+1], nil
		}
	}
	return "", ErrNotALeagueLink
}

// IsLink reports whether pasted text is a Sleeper address at all, so a
// caller choosing among hosts knows whose parser to trust.
func IsLink(pasted string) bool {
	s := strings.TrimSpace(pasted)
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	return err == nil && hosts()[strings.ToLower(u.Hostname())]
}
