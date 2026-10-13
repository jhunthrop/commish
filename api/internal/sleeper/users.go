package sleeper

import (
	"context"
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
}

type wireUser struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
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
	if len(w) > maxUsers {
		return nil, malformed("%d users in a league", len(w))
	}
	out := make([]User, 0, len(w))
	for _, u := range w {
		name := cleanName(u.DisplayName)
		if ValidID(u.UserID) && name != "" {
			out = append(out, User{ID: u.UserID, DisplayName: name})
		}
	}
	return out, nil
}

func cleanName(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		// Control and format characters (Cc, Cf): a bidi override such as
		// U+202E would turn a name around or spill its direction next door.
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s))
	if utf8.RuneCountInString(s) > maxDisplayName {
		s = string([]rune(s)[:maxDisplayName])
	}
	return s
}
