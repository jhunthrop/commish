// Package sleeper is the one client for Sleeper's public API
// (https://api.sleeper.app/v1): a draft, its picks, a user and a
// league, read by id with no sign-in (spec §2.7). Every answer is
// treated as untrusted: the body is capped, decoded into fixed shapes
// and checked for bounds before anything else reads it, and a request
// is built only from an id this package validated, never from a URL a
// caller passed in.
package sleeper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// BaseURL is Sleeper's public API.
const BaseURL = "https://api.sleeper.app/v1"

// UserAgent names the product and a contact on every request, so the
// host can reach us before it blocks us.
const UserAgent = "Commish/1.0 (+https://trycommish.app; hello@trycommish.app)"

// Timeout bounds every upstream read.
const Timeout = 3 * time.Second

// Body caps. A 32-team, 25-round draft's picks run about 360 KB.
const (
	maxPicksBody = 2 << 20
	maxBody      = 256 << 10
)

var (
	idPattern       = regexp.MustCompile(`^[0-9]{1,25}$`)
	usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,40}$`)
)

// Errors a caller tells apart.
var (
	// ErrNotFound is an id or username Sleeper does not know.
	ErrNotFound = errors.New("sleeper: not found")
	// ErrUnavailable is Sleeper not answering, or answering with a fault.
	ErrUnavailable = errors.New("sleeper: unavailable")
	// ErrMalformed is an answer that is not the shape it should be.
	ErrMalformed = errors.New("sleeper: malformed answer")
)

// ValidID reports whether s is a Sleeper id (a draft, league or user).
func ValidID(s string) bool { return idPattern.MatchString(s) }

// Client reads Sleeper.
type Client struct {
	HTTP    *http.Client
	BaseURL string
}

// New is the client with the timeout and base URL.
func New() *Client {
	// A redirect is never followed: an answer from elsewhere is not Sleeper's.
	refuse := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{HTTP: &http.Client{Timeout: Timeout, CheckRedirect: refuse}, BaseURL: BaseURL}
}

// get reads one path into out. A JSON null body (Sleeper's answer for an
// unknown id) is ErrNotFound.
func (c *Client) get(ctx context.Context, path string, limit int64, out any) error {
	return c.getWith(ctx, c.HTTP, path, limit, out)
}

// getWith is get through a given HTTP client, for a read with a longer
// timeout.
func (c *Client) getWith(ctx context.Context, hc *http.Client, path string, limit int64, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return fmt.Errorf("sleeper: request: %w", err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return fmt.Errorf("%w: read: %v", ErrUnavailable, err)
	}
	if int64(len(body)) > limit {
		return fmt.Errorf("%w: the answer is over %d bytes", ErrMalformed, limit)
	}
	if string(body) == "null" {
		return ErrNotFound
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	return nil
}

// Draft reads a draft's settings and state.
func (c *Client) Draft(ctx context.Context, id string) (Draft, error) {
	if !ValidID(id) {
		return Draft{}, ErrNotFound
	}
	var w wireDraft
	if err := c.get(ctx, "/draft/"+id, maxBody, &w); err != nil {
		return Draft{}, err
	}
	return w.validate(id)
}

// Picks reads every pick made in a draft, in the order Sleeper lists them.
func (c *Client) Picks(ctx context.Context, id string, teams, rounds int) ([]Pick, error) {
	if !ValidID(id) {
		return nil, ErrNotFound
	}
	var w []wirePick
	if err := c.get(ctx, "/draft/"+id+"/picks", maxPicksBody, &w); err != nil {
		return nil, err
	}
	return validatePicks(w, teams, rounds)
}

// UserID is the user id a username names.
func (c *Client) UserID(ctx context.Context, username string) (string, error) {
	if !usernamePattern.MatchString(username) {
		return "", ErrNotFound
	}
	var w struct {
		UserID string `json:"user_id"`
	}
	if err := c.get(ctx, "/user/"+username, maxBody, &w); err != nil {
		return "", err
	}
	if !ValidID(w.UserID) {
		return "", fmt.Errorf("%w: user id %q", ErrMalformed, w.UserID)
	}
	return w.UserID, nil
}

// League reads a league's scoring and roster.
func (c *Client) League(ctx context.Context, id string) (League, error) {
	if !ValidID(id) {
		return League{}, ErrNotFound
	}
	var w wireLeague
	if err := c.get(ctx, "/league/"+id, maxBody, &w); err != nil {
		return League{}, err
	}
	return w.validate(id)
}
