package yahoo

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Rate limits on the routes, per account (per caller on the callback).
const (
	limitConnectPerHour   = 5
	limitCallbackPerMin   = 30
	limitLeaguesPerMin    = 20
	limitDisconnectPerMin = 30
	maxCallbackParam      = 512
)

// The callback's outcomes, as the account page reads them
// (web/src/lib/hosts/yahoo.ts).
const (
	paramOutcome   = "yahoo"
	paramWhy       = "why"
	outConnected   = "connected"
	outRefused     = "refused"
	whyDenied      = "denied"
	whyExpired     = "expired"
	whySignedOut   = "signed_out"
	whyFailed      = "failed"
	whyOff         = "off"
	accountPath    = "/account"
	offWords       = "Yahoo leagues are not open here right now."
	notConnected   = "Connect Yahoo first."
	reconnectWords = "Yahoo asks you to connect again. Connect Yahoo to keep reading your leagues."
	notAnswering   = "Yahoo is not answering right now. Try again in a moment."
)

// ConnectionStore is the part of hosts.Store the routes use.
type ConnectionStore interface {
	Put(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time) (hosts.Connection, error)
	Delete(ctx context.Context, accountID uuid.UUID, host string) error
}

// StateStore keeps sign-ins in flight. *States implements it.
type StateStore interface {
	Start(ctx context.Context, f Flight, state string, now time.Time) error
	Finish(ctx context.Context, state string, now time.Time) (Flight, error)
}

// Exchanger trades a code for tokens. *OAuth implements it.
type Exchanger interface {
	AuthorizeURL(state, challenge string) string
	Exchange(ctx context.Context, code, verifier string, now time.Time) (Tokens, error)
}

// LeagueReader reads the member's leagues as them. *Member implements it.
type LeagueReader interface {
	Leagues(ctx context.Context, accountID uuid.UUID) ([]MyLeague, error)
}

// Followed is which of the host's leagues the account follows, by the
// host's league id and season. *leaguesync.Store implements it.
type Followed interface {
	FollowedIDs(ctx context.Context, accountID uuid.UUID, host string) (map[string]bool, error)
}

// Service serves connecting, reading the leagues of and disconnecting
// Yahoo.
type Service struct {
	// Enabled is HOST_YAHOO_ENABLED with the vault's key and the app's
	// Yahoo id and secret present: off, GET /hosts leaves Yahoo out and
	// every route but disconnect answers that Yahoo is not open.
	Enabled bool
	OAuth   Exchanger
	States  StateStore
	Store   ConnectionStore
	Vault   *hosts.Vault
	Leagues LeagueReader
	// Followed marks the leagues the account follows already.
	Followed Followed
	// PublicBaseURL is the site: the callback redirects there only.
	PublicBaseURL string
	Now           func() time.Time
	Log           *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/hosts/yahoo/connect", Access: httpx.SignedIn, Limit: httpx.PerHour(limitConnectPerHour), Handler: s.connect},
		{Method: http.MethodGet, Path: "/hosts/yahoo/callback", Access: httpx.Public, Limit: httpx.PerMinute(limitCallbackPerMin), Handler: s.callback},
		{Method: http.MethodGet, Path: "/hosts/yahoo/leagues", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitLeaguesPerMin), Handler: s.leagues},
		{Method: http.MethodDelete, Path: "/hosts/yahoo", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMin), Handler: hosts.Disconnect(s.Store, Host, s.Log)},
	}
}

func off(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, offWords, nil)
}

// connect starts a sign-in: a state bound to the account for ten
// minutes, a PKCE verifier kept beside it, and Yahoo's authorize address.
func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	state, err := NewState()
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "yahoo: state", err)
		return
	}
	verifier, challenge, err := NewVerifier()
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "yahoo: verifier", err)
		return
	}
	var in apitypes.YahooConnectInput
	if r.ContentLength != 0 && !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	f := Flight{Account: auth.AccountID(r), Verifier: verifier}
	if in.ReturnTo != nil {
		if !returnPath.MatchString(*in.ReturnTo) {
			httpx.WriteInvalid(w, r, map[string]string{"return_to": "A page on this site, like /league/..."})
			return
		}
		f.ReturnTo = *in.ReturnTo
	}
	if err := s.States.Start(r.Context(), f, state, s.Now()); err != nil {
		httpx.WriteInternal(w, r, s.Log, "yahoo: keep state", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.Redirect{Url: s.OAuth.AuthorizeURL(state, challenge)})
}

// returnPath is a page on the site a sign-in may return to: one leading
// slash, path characters only, so it never names another host.
var returnPath = regexp.MustCompile(`^/[A-Za-z0-9_-][A-Za-z0-9/_-]{0,199}$`)

// back redirects to the site's account page with the outcome, and
// nowhere else.
func (s *Service) back(w http.ResponseWriter, r *http.Request, outcome, why string) {
	s.backTo(w, r, accountPath, outcome, why)
}

// backTo redirects to a page on the site with the outcome: the account
// page, or the page the member started from, a checked path on
// PublicBaseURL and never another host.
func (s *Service) backTo(w http.ResponseWriter, r *http.Request, path, outcome, why string) {
	if !returnPath.MatchString(path) {
		path = accountPath
	}
	q := url.Values{paramOutcome: {outcome}}
	if why != "" {
		q.Set(paramWhy, why)
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, s.PublicBaseURL+path+"?"+q.Encode(), http.StatusFound)
}

// callback finishes a sign-in Yahoo sent back. The state must be one the
// signed-in account started: a state started by another account (a link
// someone else made) never puts this browser's Yahoo on their account.
func (s *Service) callback(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		s.back(w, r, outRefused, whyOff)
		return
	}
	q := r.URL.Query()
	state, code := q.Get("state"), q.Get("code")
	if len(state) > maxCallbackParam || len(code) > maxCallbackParam {
		s.back(w, r, outRefused, whyFailed)
		return
	}
	ctx, now := r.Context(), s.Now()
	f, err := s.finish(ctx, state, now)
	switch {
	case q.Get("error") != "":
		s.back(w, r, outRefused, whyDenied)
		return
	case errors.Is(err, ErrNoState):
		s.back(w, r, outRefused, whyExpired)
		return
	case err != nil:
		s.Log.Error("yahoo: take state", "err", err)
		s.back(w, r, outRefused, whyFailed)
		return
	}
	if me, ok := auth.AccountFrom(ctx); !ok || me.ID != f.Account {
		s.back(w, r, outRefused, whySignedOut)
		return
	}
	if code == "" {
		s.back(w, r, outRefused, whyFailed)
		return
	}
	if err := s.keep(ctx, f.Account, code, f.Verifier, now); err != nil {
		s.Log.Warn("yahoo: connect", "account", f.Account, "err", err)
		s.back(w, r, outRefused, whyFailed)
		return
	}
	if f.ReturnTo != "" {
		s.backTo(w, r, f.ReturnTo, outConnected, "")
		return
	}
	s.back(w, r, outConnected, "")
}

// finish takes the state, empty or not: a denied sign-in still uses up
// the state it carries.
func (s *Service) finish(ctx context.Context, state string, now time.Time) (Flight, error) {
	if state == "" {
		return Flight{}, ErrNoState
	}
	return s.States.Finish(ctx, state, now)
}

// keep exchanges the code and keeps the tokens, sealed.
func (s *Service) keep(ctx context.Context, accountID uuid.UUID, code, verifier string, now time.Time) error {
	t, err := s.OAuth.Exchange(ctx, code, verifier, now)
	if err != nil {
		return err
	}
	sealed, err := Seal(s.Vault, accountID, t)
	if err != nil {
		return err
	}
	_, err = s.Store.Put(ctx, accountID, Host, sealed, now)
	return err
}

func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	ctx, accountID := r.Context(), auth.AccountID(r)
	list, err := s.Leagues.Leagues(ctx, accountID)
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, notConnected, nil)
		return
	case errors.Is(err, ErrReconnect):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, reconnectWords, nil)
		return
	case err != nil:
		s.Log.Warn("yahoo: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnswering, nil)
		return
	}
	followed, err := s.Followed.FollowedIDs(ctx, accountID, Host)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "yahoo: followed", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, leagueViews(list, followed))
}

// scoringWords is Yahoo's scoring type in our words.
func scoringWords(t string) string {
	switch t {
	case "head":
		return "head to head"
	case "headpoint":
		return "head to head points"
	case "point":
		return "points only"
	case "roto":
		return "rotisserie"
	}
	return ""
}

func leagueViews(list []MyLeague, followed map[string]bool) []apitypes.HostLeague {
	out := make([]apitypes.HostLeague, 0, len(list))
	for _, l := range list {
		out = append(out, hosts.LeagueView(hosts.LeagueLine{
			LeagueID: l.LeagueID, Season: l.Season, Name: l.Name, TeamName: l.TeamName, Teams: l.Teams, Scoring: scoringWords(l.ScoringType),
		}, followed))
	}
	return out
}
