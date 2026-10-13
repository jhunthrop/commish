package sleeper

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxUsers bounds a league's members: no league seats more teams.
const maxUsers = maxTeams * 2

// maxDisplayName bounds a shown name; a longer one is cut at a rune.
const maxDisplayName = 30

// User is one league member: the id the draft order names, and the name
// the league sees.
type User struct {
	ID          string
	DisplayName string
	// TeamName is the member's team name in this league, empty when they
	// set none.
	TeamName string
}

type wireUser struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Metadata    struct {
		TeamName string `json:"team_name"`
	} `json:"metadata"`
}

// LeagueUsers reads a league's members, each name cleaned of control
// characters and bounded, a member with no usable id or name left out.
func (c *Client) LeagueUsers(ctx context.Context, leagueID string) ([]User, error) {
	if !ValidID(leagueID) {
		return nil, ErrNotFound
	}
	var w []wireUser
	if err := c.get(ctx, "/league/"+leagueID+"/users", maxBody, &w); err != nil {
		return nil, err
	}
	return validateUsers(w)
}

// DecodeUsers checks a recorded GET /league/{id}/users answer.
func DecodeUsers(body []byte) ([]User, error) {
	var w []wireUser
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validateUsers(w)
}

func validateUsers(w []wireUser) ([]User, error) {
	if len(w) > maxUsers {
		return nil, malformed("%d users in a league", len(w))
	}
	out := make([]User, 0, len(w))
	for _, u := range w {
		name := cleanName(u.DisplayName)
		if ValidID(u.UserID) && name != "" {
			out = append(out, User{ID: u.UserID, DisplayName: name, TeamName: cleanName(u.Metadata.TeamName)})
		}
	}
	return out, nil
}

func cleanName(s string) string { return cleanText(s, maxDisplayName) }

// cleanText is s with control and format characters dropped, trimmed and
// cut at limit runes: every host string a page shows goes through it.
func cleanText(s string, limit int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		// Control and format characters (Cc, Cf): a bidi override such as
		// U+202E would turn a name around or spill its direction next door.
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s))
	if utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit])
	}
	return s
}
