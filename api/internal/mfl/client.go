// Package mfl is the one client for MyFantasyLeague's export API
// (https://api.myfantasyleague.com/{year}/export?TYPE=...&L=...&JSON=1),
// read with no sign-in, so only a public league answers. Every answer is
// untrusted: the body is capped, decoded into fixed shapes and checked
// for bounds before anything else reads it. A request is built only from
// a league id and season this package validated, never from a URL a
// caller passed in, and a redirect is followed only to the host's own
// servers.
//
// MyFantasyLeague asks every client to space its requests at least one
// second apart per server and never to retry a refused one
// (api_info, "User Agent And Client Registration", read 2026-10-13).
// The client holds that gap per server for the whole process.
package mfl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// BaseURL is the host's API front door; it redirects a league's request
// to the server the league lives on.
const BaseURL = "https://api.myfantasyleague.com"

// UserAgent names the product and a contact on every request.
const UserAgent = "Commish/1.0 (+https://trycommish.app; hello@trycommish.app)"

// Timeout bounds every upstream read.
const Timeout = 3 * time.Second

// RequestGap is the host's stated spacing between requests to one server.
const RequestGap = time.Second

// Body caps. The whole player directory with details runs about 1 MB.
const (
	maxBody        = 512 << 10
	maxPlayersBody = 8 << 20
	maxRedirects   = 2
)

var (
	leagueIDPattern = regexp.MustCompile(`^[0-9]{4,6}$`)
	serverPattern   = regexp.MustCompile(`^(api|www[0-9]{2})\.myfantasyleague\.com$`)
)

// Errors a caller tells apart.
var (
	// ErrNotFound is a league the host does not know.
	ErrNotFound = errors.New("mfl: not found")
	// ErrPrivate is a league that answers only to its own members.
	ErrPrivate = errors.New("mfl: private league")
	// ErrUnavailable is the host not answering, answering with a fault,
	// or throttling us.
	ErrUnavailable = errors.New("mfl: unavailable")
	// ErrMalformed is an answer that is not the shape it should be.
	ErrMalformed = errors.New("mfl: malformed answer")
)

// ValidLeagueID reports whether s is a MyFantasyLeague league id.
func ValidLeagueID(s string) bool { return leagueIDPattern.MatchString(s) }

// Seasons a request may name.
const (
	MinSeason = 2000
	MaxSeason = 2100
)

// ValidSeason reports whether y is a season the host could hold.
func ValidSeason(y int) bool { return y >= MinSeason && y <= MaxSeason }

// Client reads MyFantasyLeague.
type Client struct {
	HTTP    *http.Client
	BaseURL string
	Now     func() time.Time
	Sleep   func(ctx context.Context, d time.Duration) error

	mu   sync.Mutex
	next map[string]time.Time
	// servers is each league's own server, learned from its league
	// export, so a read goes there directly instead of through a redirect.
	servers map[string]string
}

// New is the client with the timeout, the redirect rule and the gap.
func New() *Client {
	c := &Client{BaseURL: BaseURL, Now: time.Now, Sleep: sleepCtx, next: map[string]time.Time{}, servers: map[string]string{}}
	c.HTTP = &http.Client{Timeout: Timeout, CheckRedirect: checkRedirect}
	return c
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// checkRedirect follows the front door's redirect to a league's server
// and nowhere else.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) > maxRedirects {
		return fmt.Errorf("%w: too many redirects", ErrUnavailable)
	}
	if req.URL.Scheme != "https" || !serverPattern.MatchString(req.URL.Hostname()) {
		return fmt.Errorf("%w: redirect to %s", ErrMalformed, req.URL.Host)
	}
	return nil
}

// wait holds the gap for one server: the caller sleeps until its turn.
func (c *Client) wait(ctx context.Context, server string) error {
	c.mu.Lock()
	if c.next == nil {
		c.next = map[string]time.Time{}
	}
	now := c.Now()
	at := c.next[server]
	if at.Before(now) {
		at = now
	}
	c.next[server] = at.Add(RequestGap)
	c.mu.Unlock()
	if d := at.Sub(now); d > 0 {
		return c.Sleep(ctx, d)
	}
	return nil
}

// wireError is the host's answer for a refused export: the error is a
// bare string ("An error has occurred - probably caused by one or more
// invalid parameters." for an unknown league, read 2026-10-13) or an
// element with its text under "$t".
type wireError struct {
	Error json.RawMessage `json:"error"`
}

func (w wireError) text() (string, bool) {
	if len(w.Error) == 0 {
		return "", false
	}
	var s string
	if json.Unmarshal(w.Error, &s) == nil {
		return s, true
	}
	var el struct {
		Text string `json:"$t"`
	}
	_ = json.Unmarshal(w.Error, &el)
	return el.Text, true
}

// learnServer keeps a league's server when the host named one of its own.
func (c *Client) learnServer(leagueID, baseURL string) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" || !serverPattern.MatchString(u.Hostname()) || u.Port() != "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.servers == nil {
		c.servers = map[string]string{}
	}
	c.servers[leagueID] = u.Hostname()
}

// base is where a league's request goes: its own server once known, the
// front door before.
func (c *Client) base(leagueID string) (*url.URL, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("mfl: base url: %w", err)
	}
	c.mu.Lock()
	server, ok := c.servers[leagueID]
	c.mu.Unlock()
	if ok && base.Host == "api.myfantasyleague.com" {
		base.Host = server
	}
	return base, nil
}

// export reads one export type into out, for a league when leagueID is
// set.
func (c *Client) export(ctx context.Context, season int, leagueID, typ string, args url.Values, limit int64, out any) error {
	if !ValidSeason(season) || (leagueID != "" && !ValidLeagueID(leagueID)) {
		return ErrNotFound
	}
	base, err := c.base(leagueID)
	if err != nil {
		return err
	}
	if args == nil {
		args = url.Values{}
	}
	if leagueID != "" {
		args.Set("L", leagueID)
	}
	args.Set("TYPE", typ)
	args.Set("JSON", "1")
	u := base.JoinPath(strconv.Itoa(season), "export")
	u.RawQuery = args.Encode()
	if err := c.wait(ctx, base.Host); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return c.read(ctx, u.String(), limit, out)
}

func (c *Client) read(ctx context.Context, address string, limit int64, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return fmt.Errorf("mfl: request: %w", err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if errors.Is(err, ErrMalformed) {
			return err
		}
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode != http.StatusOK:
		// A 429 is the host throttling us: never retried here.
		return fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return fmt.Errorf("%w: read: %v", ErrUnavailable, err)
	}
	if int64(len(body)) > limit {
		return fmt.Errorf("%w: the answer is over %d bytes", ErrMalformed, limit)
	}
	return decode(body, out)
}

// decode reads an export body, telling the host's refusal apart.
func decode(body []byte, out any) error {
	var refusal wireError
	if json.Unmarshal(body, &refusal) == nil {
		if text, ok := refusal.text(); ok {
			return refusalError(text)
		}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	return nil
}

// refusalError names the host's refusal: a private league, or an id it
// does not know.
func refusalError(text string) error {
	switch {
	case privateWords.MatchString(text):
		return ErrPrivate
	case unknownWords.MatchString(text):
		return ErrNotFound
	}
	return fmt.Errorf("%w: refused: %.80q", ErrUnavailable, text)
}

var (
	privateWords = regexp.MustCompile(`(?i)private|log ?in|owners? only|not authorized|permission`)
	unknownWords = regexp.MustCompile(`(?i)invalid (league|parameter)|no such league|league id|not found|does not exist`)
)
