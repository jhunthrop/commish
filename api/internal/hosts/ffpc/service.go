package ffpc

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Rate limits: connecting is a sign-in on another site, so it is rare and
// tightly bounded; three refusals in an hour lock connecting for the hour.
const (
	limitConnectPerHour  = 5
	limitLeaguesPerMin   = 20
	limitListPerMin      = 120
	limitDisconnectPerMn = 30
	refusalWindow        = time.Hour
	maxField             = 50
)

// Signer is the part of Client a connect needs.
type Signer interface {
	SignIn(ctx context.Context, username, password string) (Cookies, []MyLeague, error)
}

// ConnectionStore is the part of hosts.Store the routes use.
type ConnectionStore interface {
	Put(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed) (hosts.Connection, error)
	List(ctx context.Context, accountID uuid.UUID) ([]hosts.Connection, error)
	Delete(ctx context.Context, accountID uuid.UUID, host string) error
}

// LeagueReader reads the member's leagues as them. *Member implements it.
type LeagueReader interface {
	Leagues(ctx context.Context, accountID uuid.UUID) ([]MyLeague, error)
}

// Service serves connecting, listing and disconnecting FFPC.
type Service struct {
	Signer  Signer
	Store   ConnectionStore
	Vault   *hosts.Vault
	Leagues LeagueReader
	Now     func() time.Time
	Log     *slog.Logger

	mu       sync.Mutex
	refusals map[uuid.UUID][]time.Time
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/hosts", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitListPerMin), Handler: s.list},
		{Method: http.MethodPost, Path: "/hosts/ffpc/connect", Access: httpx.SignedIn, Limit: httpx.PerHour(limitConnectPerHour), Handler: s.connect},
		{Method: http.MethodGet, Path: "/hosts/ffpc/leagues", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitLeaguesPerMin), Handler: s.leagues},
		{Method: http.MethodDelete, Path: "/hosts/ffpc", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMn), Handler: s.disconnect},
	}
}

// locked reports an account with MaxFailedSignIns refusals in the window.
func (s *Service) locked(accountID uuid.UUID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.recent(accountID)) >= hosts.MaxFailedSignIns
}

func (s *Service) recent(accountID uuid.UUID) []time.Time {
	now := s.Now()
	var keep []time.Time
	for _, t := range s.refusals[accountID] {
		if now.Sub(t) < refusalWindow {
			keep = append(keep, t)
		}
	}
	if s.refusals == nil {
		s.refusals = map[uuid.UUID][]time.Time{}
	}
	s.refusals[accountID] = keep
	return keep
}

func (s *Service) refused(accountID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refusals[accountID] = append(s.recent(accountID), s.Now())
}

func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	var in apitypes.HostConnectInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	email := strings.TrimSpace(in.Email)
	errs := map[string]string{}
	if len(email) < 3 || len(email) > maxField || !strings.Contains(email, "@") {
		errs["email"] = "Your FFPC sign-in email"
	}
	if in.Password == "" || len(in.Password) > maxField {
		errs["password"] = "Your FFPC password"
	}
	if !in.Consent {
		errs["consent"] = "Agree that we sign in to FFPC as you to read your league"
	}
	if len(errs) > 0 {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	if !s.Vault.Ready() {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "Connecting FFPC is not set up here", nil)
		return
	}
	accountID := auth.AccountID(r)
	if s.locked(accountID) {
		httpx.WriteError(w, r, http.StatusLocked, httpx.CodeForbidden,
			"FFPC refused three sign-ins, so connecting is paused for an hour. Check your email and password on FFPC first", nil)
		return
	}
	jar, leagues, err := s.Signer.SignIn(r.Context(), email, in.Password)
	switch {
	case errors.Is(err, ErrBadSignIn):
		s.refused(accountID)
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, "FFPC did not accept that email and password", nil)
		return
	case err != nil:
		// The error names a path at most, never the sign-in.
		s.Log.Warn("ffpc: connect", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC is not answering right now. Try again in a moment", nil)
		return
	}
	sealed, err := s.Vault.Seal(accountID.String(), Host, hosts.Secret{Username: email, Password: in.Password, Cookies: jar})
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: seal", err)
		return
	}
	conn, err := s.Store.Put(r.Context(), accountID, Host, sealed)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: keep connection", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.HostConnected{Connection: connectionView(conn), Leagues: leagueViews(leagues)})
}

func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	list, err := s.Leagues.Leagues(r.Context(), auth.AccountID(r))
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "Connect FFPC first", nil)
	case errors.Is(err, ErrNeedsSignIn):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "FFPC signed you out. Sign in again to keep reading your leagues", nil)
	case err != nil:
		s.Log.Warn("ffpc: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC is not answering right now. Try again in a moment", nil)
	default:
		httpx.WriteOK(w, r, http.StatusOK, leagueViews(list))
	}
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.List(r.Context(), auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hosts: list", err)
		return
	}
	out := make([]apitypes.HostConnection, 0, len(list))
	for _, c := range list {
		out = append(out, connectionView(c))
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

func (s *Service) disconnect(w http.ResponseWriter, r *http.Request) {
	err := s.Store.Delete(r.Context(), auth.AccountID(r), Host)
	if errors.Is(err, hosts.ErrNotConnected) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: disconnect", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

func connectionView(c hosts.Connection) apitypes.HostConnection {
	return apitypes.HostConnection{
		Host: apitypes.ConnectedHost(c.Host), Status: apitypes.HostConnectionStatus(c.Status),
		ConnectedAt: c.CreatedAt, LastReadAt: c.LastReadAt,
	}
}

func leagueViews(list []MyLeague) []apitypes.HostLeague {
	out := make([]apitypes.HostLeague, 0, len(list))
	for _, l := range list {
		out = append(out, apitypes.HostLeague{LeagueId: l.LeagueID, Name: l.Name, TeamName: l.TeamName, Record: l.Record})
	}
	return out
}
