package mfl

// The member's side of MyFantasyLeague (Lane 67): a sign-in exchanged
// once for the session cookie (MFL_USER_ID), and the reads made with that
// session, which a lineup write needs. The password is sent in a POST
// body to the login once and never kept; the session rides only in the
// Cookie header, only to the host's own servers, and never follows a
// redirect.

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SessionCookie is MyFantasyLeague's session cookie.
const SessionCookie = "MFL_USER_ID"

// MemberTimeout bounds a member's request: the import may take longer than
// a public export.
const MemberTimeout = 10 * time.Second

// Bounds on the member's requests.
const (
	maxCredential = 128
	maxLoginBody  = 16 << 10
	maxLeagues    = 200
)

var sessionPattern = regexp.MustCompile(`^[A-Za-z0-9+/=%._-]{8,512}$`)

// The member's errors.
var (
	// ErrSignedOut is a sign-in MyFantasyLeague refused, or a session it no
	// longer accepts.
	ErrSignedOut = errors.New("mfl: the sign-in or session was refused")
	// ErrNotYourTeam is a league MyFantasyLeague does not list for the
	// member, or a franchise that is not theirs.
	ErrNotYourTeam = errors.New("mfl: not the member's own team")
)

const redacted = "[redacted]"

// Session is the member's MyFantasyLeague session: the MFL_USER_ID value
// and when its cookie expires (zero when MyFantasyLeague states none). It
// never prints.
type Session struct {
	UserID  string
	Expires time.Time
}

func (Session) String() string   { return redacted }
func (Session) GoString() string { return redacted }

// LogValue keeps slog from printing it.
func (Session) LogValue() slog.Value { return slog.StringValue(redacted) }

// MarshalJSON keeps it out of any JSON.
func (Session) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// Valid reports a session in MyFantasyLeague's shape.
func (s Session) Valid() bool { return sessionPattern.MatchString(s.UserID) }

// Expired reports a session past the expiry its cookie stated.
func (s Session) Expired(now time.Time) bool { return !s.Expires.IsZero() && !now.Before(s.Expires) }

func (s Session) header() string { return SessionCookie + "=" + s.UserID }

// memberHTTP is the client for the member's requests: the client's
// transport and a longer timeout, and no redirect followed, so neither the
// password nor the session ever leaves for another address.
func (c *Client) memberHTTP() *http.Client {
	return &http.Client{Transport: c.HTTP.Transport, Timeout: MemberTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// wireLoginStatus is the login's answer: <status MFL_USER_ID="..">OK</status>
// or <error>reason</error>.
type wireLoginStatus struct {
	XMLName     xml.Name
	CookieValue string `xml:"cookie_value,attr"`
	UserID      string `xml:"MFL_USER_ID,attr"`
}

// Login exchanges the member's username and password for a session, once:
// a POST to the front door's login with the two in the body. A refusal,
// or a pair out of shape (never sent), is ErrSignedOut.
func (c *Client) Login(ctx context.Context, season int, username, password string) (Session, error) {
	if !ValidSeason(season) || !credential(username) || !credential(password) {
		return Session{}, ErrSignedOut
	}
	base, err := c.base("")
	if err != nil {
		return Session{}, err
	}
	form := url.Values{"USERNAME": {username}, "PASSWORD": {password}, "XML": {"1"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.JoinPath(strconv.Itoa(season), "login").String(), strings.NewReader(form.Encode()))
	if err != nil {
		return Session{}, fmt.Errorf("mfl: login request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	body, resp, err := c.memberDo(ctx, base.Host, req, maxLoginBody)
	if err != nil {
		return Session{}, err
	}
	return loginSession(body, resp)
}

func credential(s string) bool { return strings.TrimSpace(s) != "" && len(s) <= maxCredential }

// loginSession reads the session from the login's answer, or from its
// cookie when the answer names none, with the cookie's expiry.
func loginSession(body []byte, resp *http.Response) (Session, error) {
	var w wireLoginStatus
	if err := unmarshalXML(body, &w); err != nil || w.XMLName.Local != "status" {
		if err == nil && w.XMLName.Local == "error" {
			return Session{}, ErrSignedOut
		}
		return Session{}, fmt.Errorf("%w: the login's answer", ErrMalformed)
	}
	s := Session{UserID: w.UserID}
	if s.UserID == "" {
		s.UserID = w.CookieValue
	}
	for _, ck := range resp.Cookies() {
		if ck.Name != SessionCookie {
			continue
		}
		if s.UserID == "" {
			s.UserID = ck.Value
		}
		s.Expires = cookieExpiry(ck, time.Now())
	}
	if !s.Valid() {
		return Session{}, fmt.Errorf("%w: the login named no session", ErrMalformed)
	}
	return s, nil
}

// cookieExpiry is when the cookie lapses, zero when it states nothing.
func cookieExpiry(ck *http.Cookie, now time.Time) time.Time {
	if ck.MaxAge > 0 {
		return now.Add(time.Duration(ck.MaxAge) * time.Second).UTC()
	}
	if !ck.Expires.IsZero() {
		return ck.Expires.UTC()
	}
	return time.Time{}
}

// memberDo sends one member request at the server's turn, with no
// redirect, and reads a 200's body. The request's own errors never carry
// its body or cookie.
func (c *Client) memberDo(ctx context.Context, server string, req *http.Request, limit int64) ([]byte, *http.Response, error) {
	if err := c.wait(ctx, server); err != nil {
		if errors.Is(err, ErrBusy) {
			return nil, nil, err
		}
		return nil, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	req.Header.Set("User-Agent", UserAgent)
	resp, err := c.memberHTTP().Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: the request did not complete", ErrUnavailable)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: read: %v", ErrUnavailable, err)
	}
	if int64(len(body)) > limit {
		return nil, nil, fmt.Errorf("%w: the answer is over %d bytes", ErrMalformed, limit)
	}
	return body, resp, nil
}

// serverBase is a league's own server, when MyFantasyLeague named one of
// its own, else the front door (and always the client's base in a test).
func (c *Client) serverBase(server string) (*url.URL, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("mfl: base url: %w", err)
	}
	if base.Host == "api.myfantasyleague.com" && serverPattern.MatchString(server) {
		base.Host = server
	}
	return base, nil
}

// memberExport reads one export with the session on the server: a refusal
// in MyFantasyLeague's private words is the session refused.
func (c *Client) memberExport(ctx context.Context, sess Session, server string, season int, leagueID, typ string, args url.Values, out any) error {
	if !sess.Valid() {
		return ErrSignedOut
	}
	if !ValidSeason(season) || (leagueID != "" && !ValidLeagueID(leagueID)) {
		return ErrNotFound
	}
	base, err := c.serverBase(server)
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("mfl: request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cookie", sess.header())
	body, _, err := c.memberDo(ctx, base.Host, req, maxBody)
	if err != nil {
		return err
	}
	var refusal wireError
	if json.Unmarshal(body, &refusal) == nil {
		if text, ok := refusal.text(); ok && signedOutWords.MatchString(text) {
			return fmt.Errorf("%w: refused: %.80q", ErrSignedOut, text)
		}
	}
	return decode(body, out)
}

// signedOutWords is a refusal of a member's read that says the session is
// not accepted.
var signedOutWords = regexp.MustCompile(`(?i)log(ged)? ?in|sign(ed)? ?in|cookie|session|private|not authorized|permission`)

// MyLeague is one of the member's leagues as MyFantasyLeague lists it for
// their session: the league, their franchise in it and its server.
type MyLeague struct {
	LeagueID  string
	Name      string
	Franchise int
	TeamName  string
	Server    string
}

type wireMyLeagues struct {
	Leagues struct {
		League list[struct {
			ID            string `json:"league_id"`
			Name          string `json:"name"`
			URL           string `json:"url"`
			Franchise     string `json:"franchise_id"`
			FranchiseName string `json:"franchise_name"`
		}] `json:"league"`
	} `json:"leagues"`
}

// MyLeagues is every league MyFantasyLeague lists for the session in the
// season, and learns each league's server.
func (c *Client) MyLeagues(ctx context.Context, sess Session, season int) ([]MyLeague, error) {
	var w wireMyLeagues
	args := url.Values{"FRANCHISE_NAMES": {"1"}}
	if err := c.memberExport(ctx, sess, "", season, "", "myleagues", args, &w); err != nil {
		return nil, err
	}
	if len(w.Leagues.League) > maxLeagues {
		return nil, malformed("%d leagues", len(w.Leagues.League))
	}
	out := make([]MyLeague, 0, len(w.Leagues.League))
	for _, l := range w.Leagues.League {
		n, ok := franchiseNumber(l.Franchise)
		if !ValidLeagueID(l.ID) || !ok {
			// A league the member follows with no franchise of theirs.
			continue
		}
		server := ""
		if u, err := url.Parse(l.URL); err == nil && u.Scheme == "https" && serverPattern.MatchString(u.Hostname()) && u.Port() == "" {
			server = u.Hostname()
			c.learnServer(l.ID, l.URL)
		}
		out = append(out, MyLeague{LeagueID: l.ID, Name: cleanText(l.Name, maxNameLen), Franchise: n,
			TeamName: cleanText(l.FranchiseName, maxNameLen), Server: server})
	}
	return out, nil
}

// TeamLineup is the member's franchise in a league as their session reads
// it for MyFantasyLeague's current week: the roster, the starters, and
// the league's lineup rules.
type TeamLineup struct {
	LeagueID  string
	Season    int
	Week      int
	Franchise int
	Server    string
	// Roster is the active roster; Reserve and Taxi cannot start.
	Roster, Reserve, Taxi []string
	Starters              []string
	// StarterCount is how many start, 0 when the league does not say.
	StarterCount int
	Limits       []PositionLimit
}

// MemberLineup reads the member's own franchise in the league with their
// session: the league must be one MyFantasyLeague lists for them, and the
// week is MyFantasyLeague's current one.
func (c *Client) MemberLineup(ctx context.Context, sess Session, season int, leagueID string) (TeamLineup, error) {
	mine, err := c.MyLeagues(ctx, sess, season)
	if err != nil {
		return TeamLineup{}, err
	}
	i := -1
	for j, l := range mine {
		if l.LeagueID == leagueID {
			i = j
		}
	}
	if i < 0 {
		return TeamLineup{}, fmt.Errorf("%w: league %s", ErrNotYourTeam, leagueID)
	}
	out := TeamLineup{LeagueID: leagueID, Season: season, Franchise: mine[i].Franchise, Server: mine[i].Server}
	status, err := c.SeasonStatus(ctx, season)
	if err != nil {
		return TeamLineup{}, err
	}
	if status.Season != season || status.CurrentWeek < 1 {
		return TeamLineup{}, fmt.Errorf("%w: no current week in %d", ErrNotFound, season)
	}
	out.Week = status.CurrentWeek
	if err := c.memberTeam(ctx, sess, &out); err != nil {
		return TeamLineup{}, err
	}
	return out, nil
}

// memberTeam fills the lineup's rules, roster and starters with three
// reads on the league's server.
func (c *Client) memberTeam(ctx context.Context, sess Session, out *TeamLineup) error {
	var wl wireLeague
	if err := c.memberExport(ctx, sess, out.Server, out.Season, out.LeagueID, "league", nil, &wl); err != nil {
		return err
	}
	league, err := wl.validate(out.Season, out.LeagueID)
	if err != nil {
		return err
	}
	out.StarterCount = league.Starters
	// The limits by the engine's position names (PK is K, Def is DEF); a
	// position the engine does not start is left to MyFantasyLeague.
	for _, l := range league.StarterLimits {
		if pos := positionOf(l.Position); pos != "" {
			l.Position = pos
			out.Limits = append(out.Limits, l)
		}
	}
	var wr wireRosters
	if err := c.memberExport(ctx, sess, out.Server, out.Season, out.LeagueID, "rosters", nil, &wr); err != nil {
		return err
	}
	rosters, err := wr.validate()
	if err != nil {
		return err
	}
	for _, r := range rosters {
		if r.Franchise == out.Franchise {
			out.Roster, out.Reserve, out.Taxi = r.Players, r.Reserve, r.Taxi
		}
	}
	starters, err := c.starters(ctx, sess, out.Server, out.Season, out.LeagueID, out.Week, out.Franchise)
	out.Starters = starters
	return err
}

// starters is the franchise's starters in the week as live scoring lists
// them for the session.
func (c *Client) starters(ctx context.Context, sess Session, server string, season int, leagueID string, week, franchise int) ([]string, error) {
	if week < 1 || week > maxWeek {
		return nil, ErrNotFound
	}
	var w wireLive
	if err := c.memberExport(ctx, sess, server, season, leagueID, "liveScoring", url.Values{"W": {strconv.Itoa(week)}}, &w); err != nil {
		return nil, err
	}
	matchups, err := w.validate()
	if err != nil {
		return nil, err
	}
	for _, m := range matchups {
		for _, s := range m.Sides {
			if s.Franchise == franchise {
				return s.Starters, nil
			}
		}
	}
	return nil, nil
}

// wireAnswer is an import's answer in either of MyFantasyLeague's forms:
// <status>OK</status> or <error>words</error>, or the JSON with the same
// two names.
type wireAnswer struct {
	ok, refused bool
	words       string
}

func readAnswer(body []byte) wireAnswer {
	body = bytes.TrimSpace(body)
	if len(body) > 0 && body[0] == '{' {
		var w struct {
			Status json.RawMessage `json:"status"`
			Error  json.RawMessage `json:"error"`
		}
		if json.Unmarshal(body, &w) != nil {
			return wireAnswer{}
		}
		if text, ok := (wireError{Error: w.Error}).text(); ok {
			return wireAnswer{refused: true, words: text}
		}
		status, _ := (wireError{Error: w.Status}).text()
		return wireAnswer{ok: strings.EqualFold(strings.TrimSpace(status), "OK")}
	}
	var x struct {
		XMLName xml.Name
		Text    string `xml:",chardata"`
	}
	if unmarshalXML(body, &x) != nil {
		return wireAnswer{}
	}
	switch x.XMLName.Local {
	case "error":
		return wireAnswer{refused: true, words: x.Text}
	case "status":
		return wireAnswer{ok: strings.EqualFold(strings.TrimSpace(x.Text), "OK")}
	}
	return wireAnswer{}
}

// unmarshalXML decodes MyFantasyLeague's XML, which it declares as
// ISO-8859-1: each byte is its own code point.
func unmarshalXML(body []byte, out any) error {
	d := xml.NewDecoder(bytes.NewReader(body))
	d.CharsetReader = func(charset string, in io.Reader) (io.Reader, error) {
		if !strings.EqualFold(charset, "ISO-8859-1") && !strings.EqualFold(charset, "latin1") {
			return nil, fmt.Errorf("%w: charset %q", ErrMalformed, charset)
		}
		raw, err := io.ReadAll(io.LimitReader(in, maxWriteAnswer))
		if err != nil {
			return nil, err
		}
		runes := make([]rune, len(raw))
		for i, b := range raw {
			runes[i] = rune(b)
		}
		return strings.NewReader(string(runes)), nil
	}
	return d.Decode(out)
}
