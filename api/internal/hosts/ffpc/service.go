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

// Bounds on connecting: a sign-in on another site, so rare and tightly
// held. Three refusals in an hour pause an account's connecting for the
// hour (kept in the database, so a restart or a second instance keeps
// it), and one process sends at most connectsPerHour sign-ins an hour.
const (
	limitConnectPerHour  = 5
	limitLeaguesPerMin   = 20
	limitListPerMin      = 120
	limitDisconnectPerMn = 30
	refusalWindow        = time.Hour
	maxRefusals          = 3
	connectsPerHour      = 120
	maxField             = 128
)

// Signer is the part of Client a connect needs.
type Signer interface {
	SignIn(ctx context.Context, username, password string) (Cookies, []MyLeague, error)
}

// ConnectionStore is the part of hosts.Store the routes use.
type ConnectionStore interface {
	Put(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time) (hosts.Connection, error)
	List(ctx context.Context, accountID uuid.UUID) ([]hosts.Connection, error)
	Delete(ctx context.Context, accountID uuid.UUID, host string) error
	Refused(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
	Refusals(ctx context.Context, accountID uuid.UUID, host string, since time.Time) (int, error)
}

// LeagueReader reads the member's leagues as them. *Member implements it.
type LeagueReader interface {
	Leagues(ctx context.Context, accountID uuid.UUID) ([]MyLeague, error)
}

// Service serves connecting, listing and disconnecting FFPC.
type Service struct {
	// Enabled is HOST_FFPC_ENABLED with the vault's key present: off, the
	// list says no host is enabled and connecting answers 503.
	Enabled bool
	Signer  Signer
	Store   ConnectionStore
	Vault   *hosts.Vault
	Leagues LeagueReader
	Now     func() time.Time
	Log     *slog.Logger

	mu    sync.Mutex
	sent  int
	since time.Time
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/hosts", Access: httpx.Public, Limit: httpx.PerMinute(limitListPerMin), Handler: s.list},
		{Method: http.MethodPost, Path: "/hosts/ffpc/connect", Access: httpx.SignedIn, Limit: httpx.PerHour(limitConnectPerHour), Handler: s.connect},
		{Method: http.MethodGet, Path: "/hosts/ffpc/leagues", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitLeaguesPerMin), Handler: s.leagues},
		{Method: http.MethodDelete, Path: "/hosts/ffpc", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMn), Handler: s.disconnect},
	}
}

// allowSend counts one sign-in against the process's hourly cap.
func (s *Service) allowSend() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.Now()
	if now.Sub(s.since) >= time.Hour {
		s.sent, s.since = 0, now
	}
	if s.sent >= connectsPerHour {
		return false
	}
	s.sent++
	return true
}

func off(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "FFPC leagues are not open here right now.", nil)
}

func checkConnect(in apitypes.HostConnectInput) (string, map[string]string) {
	login := strings.TrimSpace(in.Email)
	errs := map[string]string{}
	if login == "" || len(login) > maxField {
		errs["email"] = "Type your FFPC email or username."
	}
	if in.Password == "" || len(in.Password) > maxField {
		errs["password"] = "Type your FFPC password."
	}
	if !in.Consent {
		errs["consent"] = "Tick the box to agree to how we sign in to FFPC as you."
	}
	if len(errs) > 0 {
		return "", errs
	}
	return login, nil
}

func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	var in apitypes.HostConnectInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	login, errs := checkConnect(in)
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	ctx, accountID := r.Context(), auth.AccountID(r)
	n, err := s.Store.Refusals(ctx, accountID, Host, s.Now().Add(-refusalWindow))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: refusals", err)
		return
	}
	if n >= maxRefusals {
		httpx.WriteError(w, r, http.StatusLocked, httpx.CodeForbidden,
			"FFPC refused three sign-ins, so connecting is paused for an hour. Check your email and password on FFPC first.", nil)
		return
	}
	if !s.allowSend() {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "Connecting FFPC is busy right now. Try again in a few minutes.", nil)
		return
	}
	jar, leagues, err := s.Signer.SignIn(ctx, login, in.Password)
	if s.answerSignIn(w, r, accountID, err) {
		return
	}
	sealed, err := s.Vault.Seal(accountID.String(), Host, hosts.Session(jar), hosts.SignIn{Username: login, Password: in.Password})
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: seal", err)
		return
	}
	conn, err := s.Store.Put(ctx, accountID, Host, sealed, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "ffpc: keep connection", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.HostConnected{Connection: connectionView(conn), Leagues: leagueViews(leagues)})
}

// answerSignIn answers a sign-in that did not go through, and reports
// whether it did. Only FFPC refusing the email and password counts
// toward the pause; an answer we did not expect is logged for the
// operator (status codes and cookie names, never a value).
func (s *Service) answerSignIn(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, ErrBadSignIn):
		if rerr := s.Store.Refused(r.Context(), accountID, Host, s.Now()); rerr != nil {
			s.Log.Warn("ffpc: keep refusal", "err", rerr)
		}
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, "FFPC did not accept that sign-in.", nil)
	case errors.Is(err, ErrUnexpected):
		s.Log.Error("ffpc: sign-in answered unexpectedly", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable,
			"FFPC answered in a way we did not expect. Try again in a few minutes.", nil)
	case errors.Is(err, ErrFormChanged):
		s.Log.Error("ffpc: sign-in form changed")
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable,
			"FFPC changed its sign-in page. We have paused connecting while we look.", nil)
	default:
		// The error names a path at most, never the sign-in.
		s.Log.Warn("ffpc: connect", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC is not answering right now. Try again in a moment.", nil)
	}
	return true
}

func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	list, err := s.Leagues.Leagues(r.Context(), auth.AccountID(r))
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "Connect FFPC first.", nil)
	case errors.Is(err, ErrNeedsSignIn):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "FFPC signed you out. Sign in again to keep reading your leagues.", nil)
	case err != nil:
		s.Log.Warn("ffpc: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC is not answering right now. Try again in a moment.", nil)
	default:
		httpx.WriteOK(w, r, http.StatusOK, leagueViews(list))
	}
}

// list answers the switches to anyone, since a switch is not account
// data, and the account's own connections when signed in.
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	out := apitypes.HostConnections{Enabled: []apitypes.ConnectedHost{}, Connections: []apitypes.HostConnection{}}
	if s.Enabled {
		out.Enabled = append(out.Enabled, apitypes.ConnectedHostFfpc)
	}
	account, signedIn := auth.AccountFrom(r.Context())
	if !signedIn {
		httpx.WriteOK(w, r, http.StatusOK, out)
		return
	}
	list, err := s.Store.List(r.Context(), account.ID)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hosts: list", err)
		return
	}
	for _, c := range list {
		out.Connections = append(out.Connections, connectionView(c))
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
