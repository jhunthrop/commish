package mflhost

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/season"
)

// Bounds on the routes. Three refused pairs in an hour pause connecting
// for the hour, kept in the database as the other hosts' are.
const (
	limitConnectPerHour   = 5
	limitLeaguesPerMin    = 20
	limitDisconnectPerMin = 30
	refusalWindow         = time.Hour
	maxRefusals           = 3
	maxField              = 128
	// connectBudget bounds a whole connect's requests, under the server's
	// write timeout: past it nothing is kept.
	connectBudget = 30 * time.Second
	// kindLineup is the move the switch's proof list names.
	kindLineup = "lineup"
)

// The routes' words. Every sentence names MyFantasyLeague.
const (
	offWords          = "Connecting MyFantasyLeague is not open here right now."
	notConnectedWords = "Connect MyFantasyLeague first."
	reconnectWords    = "MyFantasyLeague no longer accepts your saved sign-in. Connect MyFantasyLeague again to set your lineup from here."
	notAnsweringWords = "MyFantasyLeague is not answering right now. Try again in a moment."
	refusedWords      = "MyFantasyLeague did not accept that username and password."
	pausedWords       = "MyFantasyLeague refused three tries, so connecting is paused for an hour."
	usernameWords     = "Enter your MyFantasyLeague username."
	passwordWords     = "Enter your MyFantasyLeague password."
	consentWords      = "Agree to how we keep your MyFantasyLeague session to connect MyFantasyLeague."
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
	Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]mfl.MyLeague, error)
}

// Followed is which of the host's leagues the account follows.
// *leaguesync.Store implements it.
type Followed interface {
	FollowedIDs(ctx context.Context, accountID uuid.UUID, host string) (map[string]bool, error)
}

// Proofs is the write switch's proof list. *hostmoves.Store implements it.
type Proofs interface {
	Allowed(ctx context.Context, accountID uuid.UUID, host, kind string) (bool, error)
}

// Service serves connecting, reading the leagues of and disconnecting
// MyFantasyLeague.
type Service struct {
	// Ready is the vault's key present.
	Ready bool
	// Writes is HOST_WRITES_MFL_LINEUP: connecting exists for the lineup
	// move, so while the switch is off it is open only to the accounts on
	// its proof list.
	Writes   bool
	Proofs   Proofs
	Client   Client
	Store    ConnectionStore
	Vault    *hosts.Vault
	Leagues  LeagueReader
	Followed Followed
	Now      func() time.Time
	Log      *slog.Logger
}

// Routes is every route this package serves. Disconnecting is always
// open: a member can always delete what we keep.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/hosts/mfl/connect", Access: httpx.SignedIn, Limit: httpx.PerHour(limitConnectPerHour), Handler: s.connect},
		{Method: http.MethodGet, Path: "/hosts/mfl/leagues", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitLeaguesPerMin), Handler: s.leagues},
		{Method: http.MethodDelete, Path: "/hosts/mfl", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDisconnectPerMin), Handler: hosts.Disconnect(s.Store, Host, s.Log)},
	}
}

// OpenTo is MyFantasyLeague for an account its switch's proof list opens
// it to while the switch is off, so GET /hosts lists it to that account
// alone; nothing otherwise (with the switch on it is open to all).
func (s *Service) OpenTo(ctx context.Context, accountID uuid.UUID) ([]apitypes.ConnectedHost, error) {
	if !s.Ready || s.Writes || s.Proofs == nil {
		return nil, nil
	}
	allowed, err := s.Proofs.Allowed(ctx, accountID, Host, kindLineup)
	if err != nil || !allowed {
		return nil, err
	}
	return []apitypes.ConnectedHost{apitypes.ConnectedHostMfl}, nil
}

// open reports MyFantasyLeague open to the account: the key, and the
// switch or the account on its proof list.
func (s *Service) open(w http.ResponseWriter, r *http.Request) bool {
	ok := s.Ready && s.Writes
	if s.Ready && !s.Writes && s.Proofs != nil {
		allowed, err := s.Proofs.Allowed(r.Context(), auth.AccountID(r), Host, kindLineup)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "mflhost: allowed", err)
			return false
		}
		ok = allowed
	}
	if !ok {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, offWords, nil)
	}
	return ok
}

func checkConnect(in apitypes.MFLConnectInput) map[string]string {
	errs := map[string]string{}
	if u := strings.TrimSpace(in.Username); u == "" || len(in.Username) > maxField {
		errs["username"] = usernameWords
	}
	if strings.TrimSpace(in.Password) == "" || len(in.Password) > maxField {
		errs["password"] = passwordWords
	}
	if !in.Consent || in.ConsentVersion < 1 {
		errs["consent"] = consentWords
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// connect exchanges the pair once at MyFantasyLeague's login, reads the
// member's leagues with the session that answers, and keeps the session
// alone, sealed. The password goes nowhere else: not a log, not a row,
// not an answer.
func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	if !s.open(w, r) {
		return
	}
	var in apitypes.MFLConnectInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if errs := checkConnect(in); errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	ctx, accountID, now := r.Context(), auth.AccountID(r), s.Now()
	n, err := s.Store.Refusals(ctx, accountID, Host, now.Add(-refusalWindow))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "mflhost: refusals", err)
		return
	}
	if n >= maxRefusals {
		httpx.WriteError(w, r, http.StatusLocked, httpx.CodeForbidden, pausedWords, nil)
		return
	}
	sess, list, err := s.exchange(ctx, strings.TrimSpace(in.Username), in.Password, season.Of(now))
	if errors.Is(err, mfl.ErrSignedOut) {
		if rerr := s.Store.Refused(ctx, accountID, Host, now); rerr != nil {
			s.Log.Warn("mflhost: keep refusal", "err", rerr)
		}
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refusedWords, nil)
		return
	}
	if err != nil {
		s.Log.Warn("mflhost: connect", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnsweringWords, nil)
		return
	}
	s.keep(w, r, sess, list, in.ConsentVersion)
}

// exchange is the login and the first read with its session, within the
// connect's budget. A session MyFantasyLeague answers and then refuses is
// MyFantasyLeague not answering, never the pair refused.
func (s *Service) exchange(ctx context.Context, username, password string, yr int) (mfl.Session, []mfl.MyLeague, error) {
	ctx, cancel := context.WithTimeout(ctx, connectBudget)
	defer cancel()
	sess, err := s.Client.Login(ctx, yr, username, password)
	if err != nil {
		return mfl.Session{}, nil, err
	}
	list, err := s.Client.MyLeagues(ctx, sess, yr)
	if errors.Is(err, mfl.ErrSignedOut) {
		return mfl.Session{}, nil, fmt.Errorf("%w: the new session was refused", mfl.ErrUnavailable)
	}
	if err != nil {
		return mfl.Session{}, nil, err
	}
	s.Log.Info("mflhost: connect read", "leagues", len(list), "expires_stated", !sess.Expires.IsZero())
	return sess, list, nil
}

// keep seals the session and answers the connection and the leagues.
func (s *Service) keep(w http.ResponseWriter, r *http.Request, sess mfl.Session, list []mfl.MyLeague, shown int) {
	ctx, accountID := r.Context(), auth.AccountID(r)
	sealed, err := Seal(s.Vault, accountID, sess)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "mflhost: seal", err)
		return
	}
	conn, err := s.Store.PutConsented(ctx, accountID, Host, sealed, s.Now(), true, shown)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "mflhost: keep connection", err)
		return
	}
	views, ok := s.views(w, r, list)
	if !ok {
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.HostConnected{Connection: hosts.View(conn), Leagues: views})
}

// leagues is every league MyFantasyLeague lists for the member's session.
func (s *Service) leagues(w http.ResponseWriter, r *http.Request) {
	list, err := s.Leagues.Leagues(r.Context(), auth.AccountID(r), season.Of(s.Now()))
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, notConnectedWords, nil)
	case errors.Is(err, ErrReconnect):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, reconnectWords, nil)
	case err != nil:
		s.Log.Warn("mflhost: leagues", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnsweringWords, nil)
	default:
		if views, ok := s.views(w, r, list); ok {
			httpx.WriteOK(w, r, http.StatusOK, views)
		}
	}
}

// views is the leagues on the wire, each marked followed or not.
func (s *Service) views(w http.ResponseWriter, r *http.Request, list []mfl.MyLeague) ([]apitypes.HostLeague, bool) {
	followed, err := s.Followed.FollowedIDs(r.Context(), auth.AccountID(r), Host)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "mflhost: followed", err)
		return nil, false
	}
	yr := season.Of(s.Now())
	out := make([]apitypes.HostLeague, 0, len(list))
	for _, l := range list {
		out = append(out, hosts.LeagueView(hosts.LeagueLine{LeagueID: l.LeagueID, Season: yr, Name: l.Name, TeamName: l.TeamName}, followed))
	}
	return out, true
}
