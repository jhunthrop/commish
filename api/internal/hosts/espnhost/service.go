package espnhost

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// Bounds on the routes. Three refused pairs in an hour pause connecting
// for the hour, kept in the database as FFPC's are.
const (
	limitConnectPerHour   = 5
	limitLeaguesPerMin    = 20
	limitDisconnectPerMin = 30
	refusalWindow         = time.Hour
	maxRefusals           = 3
)

// The routes' words.
const (
	offWords       = "ESPN leagues are not open here right now."
	notConnected   = "Connect ESPN first."
	reconnectWords = "ESPN no longer accepts your saved sign-in. Connect ESPN again to keep reading your leagues."
	// notAcceptedWords is a session kept unproven that ESPN refused: it
	// never worked, so "no longer" would not be true.
	notAcceptedWords = "ESPN did not accept your saved sign-in. Connect ESPN again to read your leagues."
	notAnswering     = "ESPN is not answering right now. Try again in a moment."
	refusedWords     = "ESPN did not accept those two values. Copy them again from ESPN's site, signed in."
	pausedWords      = "ESPN refused three tries, so connecting is paused for an hour."
	swidWords        = "Paste your SWID, the value in braces."
	s2Words          = "Paste your espn_s2 value."
	consentWords     = "Agree to how we keep your ESPN session to connect ESPN."
)

// ConnectionStore is the part of hosts.Store the routes use.
type ConnectionStore interface {
	PutConsented(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time, proven bool, shown int) (hosts.Connection, error)
	Delete(ctx context.Context, accountID uuid.UUID, host string) error
	Refused(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
	Refusals(ctx context.Context, accountID uuid.UUID, host string, since time.Time) (int, error)
}

// LeagueReader reads the member's leagues as them. *Member implements it.
type LeagueReader interface {
	Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]espn.MyLeague, error)
}

// Followed is which of the host's leagues the account follows.
// *leaguesync.Store implements it.
type Followed interface {
	FollowedIDs(ctx context.Context, accountID uuid.UUID, host string) (map[string]bool, error)
}

// Service serves connecting, reading the leagues of and disconnecting
// ESPN.
type Service struct {
	// Enabled is HOST_ESPN_ENABLED with the vault's key present.
	Enabled bool
	Client  Reader
	// Public marks each listed league public or private (*Publicity, kept
	// for the hour).
	Public   PublicReader
	Store    ConnectionStore
	Vault    *hosts.Vault
	Leagues  LeagueReader
	Followed Followed
	Now      func() time.Time
	Log      *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/hosts/espn/connect", Access: httpx.SignedIn, Limit: httpx.PerHour(limitConnectPerHour), Handler: s.connect},
		{Method: http.MethodGet, Path: "/hosts/espn/leagues", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitLeaguesPerMin), Handler: s.leagues},
		{Method: http.MethodDelete, Path: "/hosts/espn", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMin), Handler: hosts.Disconnect(s.Store, Host, s.Log)},
	}
}

func off(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, offWords, nil)
}

func checkConnect(in apitypes.ESPNConnectInput) (espn.Cookies, map[string]string) {
	c := espn.Cookies{SWID: strings.TrimSpace(in.Swid), S2: strings.TrimSpace(in.EspnS2)}
	if !strings.HasPrefix(c.SWID, "{") && c.SWID != "" {
		c.SWID = "{" + strings.Trim(c.SWID, "{}") + "}"
	}
	errs := map[string]string{}
	if !espn.ValidSWID(c.SWID) {
		errs["swid"] = swidWords
	}
	if !espn.ValidS2(c.S2) {
		errs["espn_s2"] = s2Words
	}
	if !in.Consent {
		errs["consent"] = consentWords
	}
	if len(errs) > 0 {
		return espn.Cookies{}, errs
	}
	return c, nil
}

// leagues is every league ESPN lists for the member, public and private,
// each marked.
func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	yr := season.Of(s.Now())
	list, err := s.Leagues.Leagues(r.Context(), auth.AccountID(r), yr)
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, notConnected, nil)
	case errors.Is(err, ErrNotAccepted):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, notAcceptedWords, nil)
	case errors.Is(err, ErrReconnect):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, reconnectWords, nil)
	case err != nil:
		s.Log.Warn("espnhost: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnswering, nil)
	default:
		if views, ok := s.views(w, r, list, checkList(r.Context(), s.Public, s.Log, list, yr)); ok {
			httpx.WriteOK(w, r, http.StatusOK, views)
		}
	}
}

// views is the leagues on the wire, each marked followed or not, and
// public or private where it was checked, or why it was not.
func (s *Service) views(w http.ResponseWriter, r *http.Request, list []espn.MyLeague, m marks) ([]apitypes.HostLeague, bool) {
	followed, err := s.Followed.FollowedIDs(r.Context(), auth.AccountID(r), Host)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: followed", err)
		return nil, false
	}
	out := make([]apitypes.HostLeague, 0, len(list))
	for _, l := range list {
		line := hosts.LeagueLine{LeagueID: l.LeagueID, Season: l.Season, Name: l.Name, TeamName: l.TeamName, Teams: l.Teams}
		line.Public, line.Unmarked = m.mark(l.LeagueID)
		out = append(out, hosts.LeagueView(line, followed))
	}
	return out, true
}
