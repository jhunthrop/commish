package mfl

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Player is one fantasy player in the host's directory, checked: the
// positions a lineup starts, named the engine's way (PK is K, Def is
// DEF), with the name turned from "Chase, Ja'Marr" to "Ja'Marr Chase".
type Player struct {
	ID       string
	Name     string
	Position string
	Team     string
	// ESPNID is the player's ESPN id, empty when the host has none.
	ESPNID string
}

var espnPattern = regexp.MustCompile(`^[0-9]{1,12}$`)

func positionOf(p string) string {
	switch p {
	case "QB", "RB", "WR", "TE":
		return p
	case "PK":
		return "K"
	case "Def":
		return "DEF"
	}
	return ""
}

type wirePlayers struct {
	Players struct {
		Player list[struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Position string `json:"position"`
			Team     string `json:"team"`
			ESPNID   string `json:"espn_id"`
		}] `json:"player"`
	} `json:"players"`
}

// maxDirectory bounds the players kept.
const maxDirectory = 20000

// Players reads the host's player directory with other sources' ids. It
// changes slowly and the host asks that it be read rarely: the caller
// keeps it a day.
func (c *Client) Players(ctx context.Context, season int) ([]Player, error) {
	var w wirePlayers
	if err := c.export(ctx, season, "", "players", url.Values{"DETAILS": {"1"}}, maxPlayersBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodePlayers checks a recorded directory export.
func DecodePlayers(body []byte) ([]Player, error) {
	var w wirePlayers
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wirePlayers) validate() ([]Player, error) {
	if len(w.Players.Player) > maxDirectory {
		return nil, malformed("%d players", len(w.Players.Player))
	}
	var out []Player
	for _, p := range w.Players.Player {
		pos := positionOf(p.Position)
		if pos == "" || !playerIDPattern.MatchString(p.ID) || len(p.Team) > maxShortText {
			continue
		}
		name := displayName(p.Name)
		if name == "" {
			continue
		}
		pl := Player{ID: p.ID, Name: name, Position: pos, Team: strings.ToUpper(p.Team)}
		if espnPattern.MatchString(p.ESPNID) {
			pl.ESPNID = strings.TrimLeft(p.ESPNID, "0")
		}
		out = append(out, pl)
	}
	return out, nil
}

// displayName turns "Chase, Ja'Marr" into "Ja'Marr Chase", and a
// defense's "Ravens, Baltimore" into "Baltimore Ravens".
func displayName(name string) string {
	last, first, found := strings.Cut(name, ",")
	if !found {
		return cleanText(name, maxNameLen)
	}
	return cleanText(strings.TrimSpace(first)+" "+strings.TrimSpace(last), maxNameLen)
}

// ErrNotALeagueLink is pasted text that names no league on the host.
var ErrNotALeagueLink = errors.New("mfl: not a league link")

// maxLinkLen bounds what a drafter may paste.
const maxLinkLen = 300

var yearSegment = regexp.MustCompile(`^20[0-9]{2}$`)

// Ref is a league on the host: its season and id. The same id names the
// league across seasons.
type Ref struct {
	Season int
	ID     string
}

// ParseLeagueLink reads the season and league id out of a pasted link
// such as https://www43.myfantasyleague.com/2026/home/10010 or
// .../2026/options?L=10010&O=07. Only the two leave this function; the
// link is never fetched.
func ParseLeagueLink(pasted string) (Ref, error) {
	s := strings.TrimSpace(pasted)
	if s == "" || len(s) > maxLinkLen {
		return Ref{}, ErrNotALeagueLink
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || !IsHost(u.Hostname()) {
		return Ref{}, ErrNotALeagueLink
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || !yearSegment.MatchString(parts[0]) {
		return Ref{}, ErrNotALeagueLink
	}
	season, _ := strconv.Atoi(parts[0])
	id := u.Query().Get("L")
	if id == "" && len(parts) >= 3 && parts[1] == "home" {
		id = parts[2]
	}
	if !ValidSeason(season) || !ValidLeagueID(id) {
		return Ref{}, ErrNotALeagueLink
	}
	return Ref{Season: season, ID: id}, nil
}

// IsHost reports whether a host name is one of MyFantasyLeague's.
func IsHost(host string) bool {
	h := strings.ToLower(host)
	return h == "myfantasyleague.com" || strings.HasSuffix(h, ".myfantasyleague.com")
}

// IsLink reports whether pasted text is a MyFantasyLeague address at all.
func IsLink(pasted string) bool {
	s := strings.TrimSpace(pasted)
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	return err == nil && IsHost(u.Hostname())
}
