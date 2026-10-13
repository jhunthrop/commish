package ffpc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

// The client reads FFPC as a connected member: it signs in through FFPC's
// own sign-in form, posted exactly as the page's form posts it, keeps
// the cookies FFPC hands back, and reads league pages with them. It never
// posts anything else but the My Teams page's own link to open a league;
// it never sets a lineup, places a bid or makes any other move.

// BaseURL is FFPC's site.
const BaseURL = "https://myffpc.com"

// UserAgent names the product and a contact on every request.
const UserAgent = "Commish/1.0 (+https://trycommish.app; hello@trycommish.app)"

// Timing: one request a second across the whole process, however many
// members and leagues are read, and each request bounded.
const (
	Gap     = time.Second
	Timeout = 15 * time.Second
	// maxQueue is how long a read waits for its turn before it gives up.
	maxQueue = 2 * time.Minute
)

// The cookies FFPC's session lives in; nothing else is kept.
var sessionCookies = []string{"BGSLMSession", "BGSLMAuthenticated", "ASP.NET_SessionId"}

// Errors a caller tells apart. None of them carries a credential.
var (
	// ErrBadSignIn is FFPC refusing the email and password.
	ErrBadSignIn = errors.New("ffpc: sign-in refused")
	// ErrSignedOut is a session FFPC no longer honors.
	ErrSignedOut = errors.New("ffpc: signed out")
	// ErrUnavailable is FFPC failing or answering what we cannot read.
	ErrUnavailable = errors.New("ffpc: not answering")
	// ErrBusy is a read whose turn is more than maxQueue away.
	ErrBusy = errors.New("ffpc: busy")
)

// Cookies is a session as FFPC handed it back, by cookie name.
type Cookies map[string]string

// Client is FFPC over HTTP.
type Client struct {
	Base string
	HTTP *http.Client
	gap  *rate.Limiter
}

// New is the client for FFPC's site.
func New() *Client { return NewAt(BaseURL) }

// NewAt is a client for another base, a test server.
func NewAt(base string) *Client {
	return &Client{
		Base: strings.TrimRight(base, "/"),
		HTTP: &http.Client{
			Timeout: Timeout,
			// Redirects are read, never followed: a redirect off a league
			// page is a session FFPC no longer honors.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		gap: rate.NewLimiter(rate.Every(Gap), 1),
	}
}

func (c *Client) wait(ctx context.Context) error {
	r := c.gap.Reserve()
	if d := r.Delay(); d > maxQueue {
		r.Cancel()
		return ErrBusy
	}
	t := time.NewTimer(r.Delay())
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		r.Cancel()
		return ctx.Err()
	}
}

// response is one answer: its status, where it sends us, its body and
// the session cookies it set.
type response struct {
	status   int
	location string
	body     []byte
	set      Cookies
}

func (c *Client) do(ctx context.Context, method, path string, form url.Values, jar Cookies) (response, error) {
	if err := c.wait(ctx); err != nil {
		return response{}, err
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, body)
	if err != nil {
		return response{}, fmt.Errorf("ffpc: request: %w", err)
	}
	req.Header.Set("User-Agent", UserAgent)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for _, name := range sessionCookies {
		if v, ok := jar[name]; ok {
			req.AddCookie(&http.Cookie{Name: name, Value: v})
		}
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		// The error names the path only; the jar never reaches it.
		return response{}, fmt.Errorf("%w: %s %s", ErrUnavailable, method, path)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxPage+1))
	if err != nil || len(raw) > MaxPage {
		return response{}, fmt.Errorf("%w: %s body", ErrUnavailable, path)
	}
	out := response{status: resp.StatusCode, location: resp.Header.Get("Location"), body: raw, set: Cookies{}}
	for _, ck := range resp.Cookies() {
		for _, name := range sessionCookies {
			if ck.Name == name {
				out.set[name] = ck.Value
			}
		}
	}
	return out, nil
}

// merged is the jar with the answer's cookies laid over it, a new map.
func merged(jar, set Cookies) Cookies {
	out := Cookies{}
	for k, v := range jar {
		out[k] = v
	}
	for k, v := range set {
		if v == "" {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

const (
	loginPath   = "/account/Login.aspx"
	myTeamsPath = "/MyTeams.aspx"
	// The sign-in form's own field names (Login.aspx, 2026-10-13).
	fieldUser   = "txtExistingUsername"
	fieldPass   = "txtExistingPassword"
	fieldSubmit = "btnSignIn"
	submitValue = "SIGN IN"
)

// SignIn posts the member's email and password to FFPC's sign-in form,
// with the hidden fields the form carries, and answers the session FFPC
// sets. The password goes to FFPC and nowhere else.
func (c *Client) SignIn(ctx context.Context, username, password string) (Cookies, []MyLeague, error) {
	page, err := c.do(ctx, http.MethodGet, loginPath, nil, nil)
	if err != nil {
		return nil, nil, err
	}
	if page.status != http.StatusOK {
		return nil, nil, fmt.Errorf("%w: sign-in page %d", ErrUnavailable, page.status)
	}
	form, err := hiddenFields(page.body, "form1")
	if err != nil {
		return nil, nil, err
	}
	form.Set(fieldUser, username)
	form.Set(fieldPass, password)
	form.Set(fieldSubmit, submitValue)
	jar := merged(nil, page.set)
	posted, err := c.do(ctx, http.MethodPost, loginPath, form, jar)
	if err != nil {
		return nil, nil, err
	}
	jar = merged(jar, posted.set)
	// Signed in is My Teams answering: FFPC sends a signed-out visitor
	// from it to the public front page.
	leagues, err := c.MyTeams(ctx, jar)
	if err != nil {
		if errors.Is(err, ErrSignedOut) {
			return nil, nil, ErrBadSignIn
		}
		return nil, nil, err
	}
	return jar, leagues, nil
}

// signedOut reports an answer that sends a member's read away: to the
// public front page, the sign-in page or My Teams.
func signedOut(r response) bool {
	if r.status < 300 || r.status >= 400 {
		return false
	}
	loc := strings.ToLower(r.location)
	return strings.Contains(loc, "/cms/public") || strings.Contains(loc, "login.aspx") || strings.Contains(loc, "myteams.aspx")
}

var ltuidShape = regexp.MustCompile(`^[0-9A-F]{3}-[0-9A-F]{12}$`)

// ValidLTUID reports a league-team id of FFPC's shape, the only thing a
// league page's address takes.
func ValidLTUID(s string) bool { return ltuidShape.MatchString(s) }

// Page is one league page as the member sees it: path is one of the
// pages named in Pages, ltuid the member's own league-team id.
func (c *Client) Page(ctx context.Context, jar Cookies, page PageName, ltuid string) ([]byte, Cookies, error) {
	path, ok := pagePaths[page]
	if !ok || !ValidLTUID(ltuid) {
		return nil, jar, fmt.Errorf("ffpc: page %q", page)
	}
	r, err := c.do(ctx, http.MethodGet, path+"?ltuid="+url.QueryEscape(ltuid), nil, jar)
	if err != nil {
		return nil, jar, err
	}
	jar = merged(jar, r.set)
	switch {
	case signedOut(r):
		return nil, jar, ErrSignedOut
	case r.status != http.StatusOK:
		return nil, jar, fmt.Errorf("%w: %s %d", ErrUnavailable, page, r.status)
	}
	return r.body, jar, nil
}

// MyTeams is the member's leagues.
func (c *Client) MyTeams(ctx context.Context, jar Cookies) ([]MyLeague, error) {
	r, err := c.do(ctx, http.MethodGet, myTeamsPath, nil, jar)
	if err != nil {
		return nil, err
	}
	if signedOut(r) {
		return nil, ErrSignedOut
	}
	if r.status != http.StatusOK {
		return nil, fmt.Errorf("%w: my teams %d", ErrUnavailable, r.status)
	}
	return ParseMyTeams(r.body)
}

var ltuidInLocation = regexp.MustCompile(`(?i)ltuid=([0-9A-F]{3}-[0-9A-F]{12})`)

// OpenLeague follows My Teams' own link to one of the member's leagues
// (a postback, as the page's link does) and answers its league-team id.
func (c *Client) OpenLeague(ctx context.Context, jar Cookies, leagueID string) (string, error) {
	r, err := c.do(ctx, http.MethodGet, myTeamsPath, nil, jar)
	if err != nil {
		return "", err
	}
	if signedOut(r) {
		return "", ErrSignedOut
	}
	leagues, err := ParseMyTeams(r.body)
	if err != nil {
		return "", err
	}
	target := ""
	for _, l := range leagues {
		if l.LeagueID == leagueID {
			target = l.Target
		}
	}
	if target == "" {
		return "", ErrNotThisPage
	}
	form, err := hiddenFields(r.body, "form1")
	if err != nil {
		return "", err
	}
	form.Set("__EVENTTARGET", target)
	form.Set("__EVENTARGUMENT", "")
	posted, err := c.do(ctx, http.MethodPost, myTeamsPath, form, merged(jar, r.set))
	if err != nil {
		return "", err
	}
	if m := ltuidInLocation.FindStringSubmatch(posted.location); m != nil {
		return strings.ToUpper(m[1]), nil
	}
	if m := ltuidInLocation.FindStringSubmatch(string(posted.body)); m != nil {
		return strings.ToUpper(m[1]), nil
	}
	return "", ErrNotThisPage
}

// hiddenFields is the hidden inputs of the form with the id: ASP.NET's
// view state and its kin, which a post must echo.
func hiddenFields(page []byte, formID string) (url.Values, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, err
	}
	form := first(doc, func(n *node) bool { return isTag(n, "form") && attr(n, "id") == formID })
	if form == nil {
		return nil, ErrNotThisPage
	}
	out := url.Values{}
	for _, in := range all(form, tag("input")) {
		if strings.EqualFold(attr(in, "type"), "hidden") && attr(in, "name") != "" {
			out.Set(attr(in, "name"), attr(in, "value"))
		}
	}
	return out, nil
}
