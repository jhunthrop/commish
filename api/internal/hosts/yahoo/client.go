package yahoo

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

// UserAgent names the product and a contact on every request.
const UserAgent = "Commish/1.0 (+https://trycommish.app; hello@trycommish.app)"

// DefaultBase is the Fantasy Sports API.
const DefaultBase = "https://fantasysports.yahooapis.com/fantasy/v2"

// Pacing and bounds on one read. Yahoo asks apps to stay well under a few
// thousand requests an hour; one request a quarter second across every
// process is far under it, and a league read is three requests.
const (
	Gap      = 250 * time.Millisecond
	MaxQueue = 10 * time.Second
	Timeout  = 15 * time.Second
	maxBody  = 4 << 20
)

// Errors a read ends in.
var (
	// ErrUnauthorized is an access token Yahoo no longer honors: the
	// member reader refreshes it once and reads again.
	ErrUnauthorized = errors.New("yahoo: access token refused")
	// ErrNoSuchLeague is a league Yahoo does not show this member.
	ErrNoSuchLeague = errors.New("yahoo: no such league for this member")
	// ErrBusy is Yahoo asking us to slow down, or our own pace full.
	ErrBusy = errors.New("yahoo: busy")
	// ErrMalformed is an answer that does not read as Yahoo's XML.
	ErrMalformed = errors.New("yahoo: answer does not read")
)

// Pace waits for a request's turn. *hosts.Gate paces every process.
type Pace interface {
	Wait(ctx context.Context) error
}

type localPace struct{ lim *rate.Limiter }

func (p localPace) Wait(ctx context.Context) error { return p.lim.Wait(ctx) }

// LocalPace is a pace of one request a gap within this process.
func LocalPace(gap time.Duration) Pace { return localPace{lim: rate.NewLimiter(rate.Every(gap), 1)} }

// Client reads the Fantasy Sports API with a member's access token.
type Client struct {
	HTTP *http.Client
	Base string
	Pace Pace
}

// New is a client on Yahoo. A redirect is never followed: an answer from
// anywhere but the API is not Yahoo's.
func New() *Client {
	refuse := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{HTTP: &http.Client{Timeout: Timeout, CheckRedirect: refuse}, Base: DefaultBase, Pace: LocalPace(Gap)}
}

var (
	leagueIDPattern = regexp.MustCompile(`^[0-9]{1,12}$`)
	gameKeyPattern  = regexp.MustCompile(`^[0-9]{1,6}$`)
	// currentGame is the current season's football game, as a league key may name it.
	currentGame = "nfl"
)

// LeagueKey is Yahoo's key for a league in a season's game, from parts
// this package checked.
func LeagueKey(gameKey, leagueID string) (string, error) {
	if (gameKey != currentGame && !gameKeyPattern.MatchString(gameKey)) || !leagueIDPattern.MatchString(leagueID) {
		return "", fmt.Errorf("%w: league %q in game %q", ErrNoSuchLeague, leagueID, gameKey)
	}
	return gameKey + ".l." + leagueID, nil
}

// get reads one resource path under the API with the access token. Its
// errors name the status, never the token or the body.
func (c *Client) get(ctx context.Context, access, path string) ([]byte, error) {
	if err := c.Pace.Wait(ctx); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBusy, err)
	}
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Base+"/"+path, nil)
	if err != nil {
		return nil, fmt.Errorf("yahoo: request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Accept", "application/xml")
	req.Header.Set("User-Agent", UserAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%w: %w", ErrUnavailable, ctx.Err())
		}
		return nil, fmt.Errorf("%w: unreachable", ErrUnavailable)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return nil, ErrUnauthorized
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound:
		return nil, fmt.Errorf("%w: status %d", ErrNoSuchLeague, resp.StatusCode)
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == 999:
		return nil, fmt.Errorf("%w: status %d", ErrBusy, resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%w: status %s", ErrUnavailable, strconv.Itoa(resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, fmt.Errorf("%w: body: %w", ErrUnavailable, err)
	}
	if len(body) > maxBody {
		return nil, fmt.Errorf("%w: over %d bytes", ErrMalformed, maxBody)
	}
	return body, nil
}

// MyLeagues is the member's football leagues in the current season's
// game, with their own team in each.
func (c *Client) MyLeagues(ctx context.Context, access string) ([]MyLeague, error) {
	leagues, err := c.get(ctx, access, "users;use_login=1/games;game_keys=nfl/leagues")
	if err != nil {
		return nil, err
	}
	teams, err := c.get(ctx, access, "users;use_login=1/games;game_keys=nfl/teams")
	if err != nil {
		return nil, err
	}
	return ParseMyLeagues(leagues, teams)
}

// GameKey is the football game's key for a season.
func (c *Client) GameKey(ctx context.Context, access string, season int) (string, error) {
	if season < 2000 || season > 2100 {
		return "", fmt.Errorf("%w: season %d", ErrNoSuchLeague, season)
	}
	body, err := c.get(ctx, access, "games;game_codes=nfl;seasons="+strconv.Itoa(season))
	if err != nil {
		return "", err
	}
	return ParseGameKey(body, season)
}

// League is one whole read of a league: its settings, standings, the
// week's scoreboard and recent moves, every team's roster, and the
// players on waivers.
func (c *Client) League(ctx context.Context, access, leagueKey string) (League, error) {
	head, err := c.get(ctx, access, "league/"+leagueKey+";out=settings,standings,scoreboard,transactions")
	if err != nil {
		return League{}, err
	}
	rosters, err := c.get(ctx, access, "league/"+leagueKey+"/teams;out=roster")
	if err != nil {
		return League{}, err
	}
	l, err := ParseLeague(head, rosters)
	if err != nil {
		return League{}, err
	}
	// The waiver wire is a part the league reads without: a failed read
	// of it leaves waiver status unknown for this read (WaiversErr says
	// why), never fails the league.
	l.Waivers, l.WaiversErr = c.waivers(ctx, access, leagueKey)
	if ctx.Err() != nil {
		return League{}, ctx.Err()
	}
	return l, nil
}

// Scoreboard is one week's scoreboard of a league (the documented
// league/{key}/scoreboard;week=N, Lane 298): each matchup's two teams,
// their points and whether Yahoo has scored it final.
func (c *Client) Scoreboard(ctx context.Context, access, leagueKey string, week int) (Scoreboard, error) {
	if week < 1 || week > maxWeek {
		return Scoreboard{}, fmt.Errorf("%w: week %d", ErrNoSuchLeague, week)
	}
	body, err := c.get(ctx, access, "league/"+leagueKey+"/scoreboard;week="+strconv.Itoa(week))
	if err != nil {
		return Scoreboard{}, err
	}
	return ParseScoreboard(body)
}

// Bounds on the waiver read: Yahoo answers at most a page of 25 players,
// and a league's waiver wire is a few dozen at most.
const (
	waiverPage  = 25
	waiverPages = 4
)

// waivers is the league's players on waivers, a page at a time until a
// page comes back short.
func (c *Client) waivers(ctx context.Context, access, leagueKey string) ([]Waiver, error) {
	var out []Waiver
	for page := range waiverPages {
		body, err := c.get(ctx, access, fmt.Sprintf("league/%s/players;status=W;out=ownership;start=%d;count=%d",
			leagueKey, page*waiverPage, waiverPage))
		if err != nil {
			return nil, err
		}
		list, n, err := ParseWaivers(body)
		if err != nil {
			return nil, err
		}
		out = append(out, list...)
		if n < waiverPage {
			break
		}
	}
	return out, nil
}
