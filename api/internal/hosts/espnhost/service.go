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
	notAnswering   = "ESPN is not answering right now. Try again in a moment."
	refusedWords   = "ESPN did not accept those two values. Copy them again from ESPN's site, signed in."
	pausedWords    = "ESPN refused three tries, so connecting is paused for an hour."
	swidWords      = "Paste your SWID, the value in braces."
	s2Words        = "Paste your espn_s2 value."
	consentWords   = "Tick the box to agree to how we keep your ESPN session."
)

// ConnectionStore is the part of hosts.Store the routes use.
type ConnectionStore interface {
	Put(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time) (hosts.Connection, error)
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
	Enabled  bool
	Client   Reader
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
		{Method: http.MethodDelete, Path: "/hosts/espn", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMin), Handler: s.disconnect},
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

// connect verifies the two cookies with one read of the member's leagues
// (and one read of a league, which is what needs espn_s2), then keeps
// them sealed.
func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	var in apitypes.ESPNConnectInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	cookies, errs := checkConnect(in)
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	ctx, accountID, now := r.Context(), auth.AccountID(r), s.Now()
	n, err := s.Store.Refusals(ctx, accountID, Host, now.Add(-refusalWindow))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: refusals", err)
		return
	}
	if n >= maxRefusals {
		httpx.WriteError(w, r, http.StatusLocked, httpx.CodeForbidden, pausedWords, nil)
		return
	}
	list, err := s.verify(ctx, cookies, season.Of(now))
	if errors.Is(err, espn.ErrSignedOut) {
		if rerr := s.Store.Refused(ctx, accountID, Host, now); rerr != nil {
			s.Log.Warn("espnhost: keep refusal", "err", rerr)
		}
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refusedWords, nil)
		return
	}
	if err != nil {
		s.Log.Warn("espnhost: connect", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnswering, nil)
		return
	}
	sealed, err := Seal(s.Vault, accountID, cookies)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: seal", err)
		return
	}
	conn, err := s.Store.Put(ctx, accountID, Host, sealed, now)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: keep connection", err)
		return
	}
	views, ok := s.views(w, r, list)
	if !ok {
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.HostConnected{Connection: hosts.View(conn), Leagues: views})
}

// verify reads the member's leagues with the cookies, and the first of
// them, since a private league's read is what proves espn_s2.
func (s *Service) verify(ctx context.Context, c espn.Cookies, yr int) ([]espn.MyLeague, error) {
	list, err := s.Client.MyLeagues(ctx, c, yr)
	if err != nil || len(list) == 0 {
		return list, err
	}
	_, err = s.Client.Read(ctx, list[0].LeagueID, yr, &c)
	return list, err
}

func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	list, err := s.Leagues.Leagues(r.Context(), auth.AccountID(r), season.Of(s.Now()))
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, notConnected, nil)
	case errors.Is(err, ErrReconnect):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, reconnectWords, nil)
	case err != nil:
		s.Log.Warn("espnhost: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnswering, nil)
	default:
		if views, ok := s.views(w, r, list); ok {
			httpx.WriteOK(w, r, http.StatusOK, views)
		}
	}
}

// views is the leagues on the wire, each marked followed or not.
func (s *Service) views(w http.ResponseWriter, r *http.Request, list []espn.MyLeague) ([]apitypes.HostLeague, bool) {
	followed, err := s.Followed.FollowedIDs(r.Context(), auth.AccountID(r), Host)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: followed", err)
		return nil, false
	}
	out := make([]apitypes.HostLeague, 0, len(list))
	for _, l := range list {
		v := apitypes.HostLeague{LeagueId: l.LeagueID, Name: l.Name, TeamName: l.TeamName}
		attached := followed[hosts.FollowKey(l.LeagueID, l.Season)]
		v.Attached = &attached
		if l.Teams > 0 {
			teams := l.Teams
			v.Teams = &teams
		}
		out = append(out, v)
	}
	return out, true
}

func (s *Service) disconnect(w http.ResponseWriter, r *http.Request) {
	err := s.Store.Delete(r.Context(), auth.AccountID(r), Host)
	if errors.Is(err, hosts.ErrNotConnected) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: disconnect", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}
