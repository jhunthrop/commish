// Package espn reads one public ESPN fantasy football league's scoring
// settings (lm-api-reads, view=mSettings), the only ESPN read the api
// makes: a league's rules for custom scoring. The client takes a league
// id and a season, never a URL from a body, and trusts nothing it reads:
// every answer is size-capped, shape-checked and bounded.
package espn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// UserAgent names the product and a contact, as every host client does.
const UserAgent = "Commish/1.0 (+https://trycommish.app; hello@trycommish.app)"

// DefaultBase is ESPN's league read host.
const DefaultBase = "https://lm-api-reads.fantasy.espn.com"

// Bounds on what one read takes in.
const (
	maxBody      = 2 << 20
	maxItems     = 400
	maxStatID    = 1000
	maxPoints    = 100
	readTimeout  = 5 * time.Second
	minSeason    = 2000
	maxSeason    = 2100
	maxNameRunes = 80
)

// The ways a read fails, each a different sentence to the drafter.
var (
	ErrNotALink    = errors.New("espn: not an ESPN league link")
	ErrNotFound    = errors.New("espn: no league at that id")
	ErrPrivate     = errors.New("espn: the league is private")
	ErrUnavailable = errors.New("espn: ESPN is not answering")
	ErrMalformed   = errors.New("espn: ESPN answered something that cannot be")
)

var (
	leagueID = regexp.MustCompile(`^[0-9]{1,12}$`)
	espnHost = regexp.MustCompile(`(^|\.)espn\.com$`)
)

// Ref is a league and season.
type Ref struct {
	LeagueID string
	// Season is the link's seasonId, 0 when it names none.
	Season int
}

// Parse reads a league out of pasted text: an ESPN fantasy football link
// with leagueId (and seasonId when it has one), or a bare league id. Only
// the ids leave it.
func Parse(pasted string) (Ref, error) {
	s := strings.TrimSpace(pasted)
	if leagueID.MatchString(s) {
		return Ref{LeagueID: s}, nil
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !espnHost.MatchString(strings.ToLower(u.Hostname())) {
		return Ref{}, ErrNotALink
	}
	q := u.Query()
	ref := Ref{LeagueID: q.Get("leagueId")}
	if !leagueID.MatchString(ref.LeagueID) {
		return Ref{}, ErrNotALink
	}
	if v := q.Get("seasonId"); v != "" {
		season, err := strconv.Atoi(v)
		if err != nil || season < minSeason || season > maxSeason {
			return Ref{}, ErrNotALink
		}
		ref.Season = season
	}
	return ref, nil
}

// Item is one scoring rule as ESPN states it: points per stat, with
// overrides by lineup slot ("6" a tight end, "16" a defense).
type Item struct {
	StatID    int                `json:"statId"`
	Points    float64            `json:"points"`
	Overrides map[string]float64 `json:"pointsOverrides"`
}

// League is the part of a league's settings the import reads.
type League struct {
	Name  string
	Items []Item
}

type wireLeague struct {
	Settings struct {
		Name            string `json:"name"`
		ScoringSettings struct {
			ScoringItems []Item `json:"scoringItems"`
		} `json:"scoringSettings"`
	} `json:"settings"`
}

// Client reads ESPN.
type Client struct {
	HTTP *http.Client
	Base string
}

// New is a client on ESPN with the read timeout.
func New() *Client { return &Client{HTTP: &http.Client{Timeout: readTimeout}, Base: DefaultBase} }

// League is a public league's scoring settings for a season.
func (c *Client) League(ctx context.Context, ref Ref, season int) (League, error) {
	if !leagueID.MatchString(ref.LeagueID) || season < minSeason || season > maxSeason {
		return League{}, ErrNotALink
	}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?view=mSettings", c.Base, season, ref.LeagueID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
	if err != nil {
		return League{}, fmt.Errorf("espn: request: %w", err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return League{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return League{}, ErrPrivate
	case resp.StatusCode == http.StatusNotFound:
		return League{}, ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return League{}, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	var wire wireLeague
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&wire); err != nil {
		return League{}, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	return check(wire)
}

func check(wire wireLeague) (League, error) {
	items := wire.Settings.ScoringSettings.ScoringItems
	if len(items) == 0 || len(items) > maxItems {
		return League{}, fmt.Errorf("%w: %d scoring items", ErrMalformed, len(items))
	}
	for _, it := range items {
		if it.StatID < 0 || it.StatID > maxStatID || !bounded(it.Points) {
			return League{}, fmt.Errorf("%w: stat %d at %v", ErrMalformed, it.StatID, it.Points)
		}
		for slot, v := range it.Overrides {
			if _, err := strconv.Atoi(slot); err != nil || !bounded(v) {
				return League{}, fmt.Errorf("%w: stat %d override %q", ErrMalformed, it.StatID, slot)
			}
		}
	}
	name := []rune(strings.TrimSpace(wire.Settings.Name))
	if len(name) > maxNameRunes {
		name = name[:maxNameRunes]
	}
	return League{Name: string(name), Items: items}, nil
}

func bounded(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && math.Abs(v) <= maxPoints }
