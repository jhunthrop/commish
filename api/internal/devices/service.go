// Package devices pairs a member's browser extension with their account
// (spec §2.8, Lane 14): the account page shows a one-time code of six
// words, the extension trades it for a scoped device token, and the
// account page lists each paired browser with a revoke verb. The token
// itself is checked by auth.Bearer; this package mints and keeps it.
package devices

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Rate limits. Pairing is by address and tight: a code is 48 bits and
// lives ten minutes, so at 10 a minute a guess never lands.
const (
	limitCodePerMinute   = 6
	limitPairPerMinute   = 10
	limitReadPerMinute   = 120
	limitRevokePerMinute = 30
	maxNameLen           = 60
)

// defaultNames name a device that did not name itself, by kind.
var defaultNames = map[auth.DeviceKind]string{
	auth.KindExtension: "A browser",
	auth.KindIOS:       "An iPhone",
	auth.KindAndroid:   "An Android phone",
}

// The pairing refusals, by where the member gets a new code.
const (
	badPageCode = "That code has been used or is more than ten minutes old. Show a new one on your account page"
	badAppCode  = "That code has been used or is more than ten minutes old. Sign in again"
	badKind     = "Pair as extension, ios or android"
	badVerifier = "Send the code_verifier this app began its sign-in with, or sign in again"
	tooMany     = "Your account has %d paired devices, the most allowed. Unpair one first"
)

// Errors AppCode answers, never a member's.
var (
	errNotAnApp    = errors.New("devices: app codes are for ios and android")
	errNoChallenge = errors.New("devices: an app code needs an S256 challenge")
)

// Repository is the part of Store the handlers use.
type Repository interface {
	PutCode(ctx context.Context, accountID uuid.UUID, b Binding, hash []byte, expires time.Time, workosSID string) error
	Pair(ctx context.Context, code []byte, b Binding, name string, tokenHash []byte, scopes []auth.Scope, now time.Time) (uuid.UUID, Device, error)
	List(ctx context.Context, accountID uuid.UUID) ([]Device, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (Device, error)
	Revoke(ctx context.Context, accountID, id uuid.UUID, now time.Time) (string, error)
}

// Minter mints device tokens. *auth.Bearer implements it.
type Minter interface {
	Mint() (token string, hash []byte)
}

// LogoutURLs builds the URL that ends a WorkOS session. auth's
// IdentityProvider (WorkOS) implements it.
type LogoutURLs interface {
	LogoutURL(sessionID, returnTo string) (string, error)
}

// Service serves the device routes.
type Service struct {
	Store Repository
	// Push is an app's push registration (Lane 262); *Store implements
	// both.
	Push   PushRepository
	Tokens Minter
	// CodeKey keys the pairing codes' stored hashes (PurposeCodes).
	CodeKey []byte
	// IdP and SignedOutURL answer an app's own sign-out with the WorkOS
	// logout URL, returning to SignedOutURL; a nil IdP answers url null.
	IdP          LogoutURLs
	SignedOutURL string
	Now          func() time.Time
	Log          *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return append([]httpx.Route{
		{Method: http.MethodPost, Path: "/devices/codes", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitCodePerMinute), Handler: s.code},
		{Method: http.MethodPost, Path: "/devices/pair", Access: httpx.Public, Limit: httpx.PerMinute(limitPairPerMinute), Handler: s.pair},
		{Method: http.MethodGet, Path: "/devices", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.list},
		{Method: http.MethodDelete, Path: "/devices/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitRevokePerMinute), Handler: s.revoke},
		{Method: http.MethodGet, Path: "/devices/me", Access: httpx.Device, Scope: string(auth.ScopeLeagueWrite),
			Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.me},
	}, s.pushRoutes()...)
}

// issue stores a fresh code under its binding on the account, replacing
// its earlier code, and answers it with when it ends. workosSID rides on
// an app's code to its device.
func (s *Service) issue(ctx context.Context, accountID uuid.UUID, b Binding, workosSID string) (string, time.Time, error) {
	code, err := NewCode()
	if err != nil {
		return "", time.Time{}, err
	}
	expires := s.Now().Add(CodeTTL)
	if err := s.Store.PutCode(ctx, accountID, b, codeHash(s.CodeKey, code), expires, workosSID); err != nil {
		return "", time.Time{}, err
	}
	return code, expires, nil
}

// AppCode is the code an app's sign-in hands back to the app (auth's
// callback): good for one device of that app's kind, for ten minutes,
// and only with the verifier behind challenge. The device it pairs keeps
// workosSID, the WorkOS session the sign-in began.
func (s *Service) AppCode(ctx context.Context, accountID uuid.UUID, kind auth.DeviceKind, challenge, workosSID string) (string, error) {
	if !kind.IsApp() {
		return "", errNotAnApp
	}
	if !auth.ValidChallenge(challenge) {
		return "", errNoChallenge
	}
	code, _, err := s.issue(ctx, accountID, Binding{Kind: kind, Challenge: challenge}, workosSID)
	return code, err
}

// code is the account page's code, for the extension.
func (s *Service) code(w http.ResponseWriter, r *http.Request) {
	code, expires, err := s.issue(r.Context(), auth.AccountID(r), Binding{Kind: auth.KindExtension}, "")
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: code", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.PairCode{Code: code, ExpiresAt: expires})
}

// pairBinding is the binding a pairing asks to spend: the extension when
// it names no kind, as the extension has always paired, with no
// challenge; an app with the S256 challenge of the verifier it sent. A
// fault names the field and its sentence.
func pairBinding(in apitypes.PairInput) (Binding, map[string]string) {
	kind := auth.KindExtension
	if in.Kind != nil {
		k, ok := auth.ParseDeviceKind(string(*in.Kind))
		if !ok {
			return Binding{}, map[string]string{"kind": badKind}
		}
		kind = k
	}
	if !kind.IsApp() {
		return Binding{Kind: kind}, nil
	}
	if in.CodeVerifier == nil || !auth.ValidVerifier(*in.CodeVerifier) {
		return Binding{}, map[string]string{"code_verifier": badVerifier}
	}
	return Binding{Kind: kind, Challenge: auth.PKCEChallenge(*in.CodeVerifier)}, nil
}

func (s *Service) pair(w http.ResponseWriter, r *http.Request) {
	var in apitypes.PairInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	binding, fault := pairBinding(in)
	if fault != nil {
		httpx.WriteInvalid(w, r, fault)
		return
	}
	kind := binding.Kind
	code, ok := NormalizeCode(in.Code)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{"code": fmt.Sprintf("Type the %d words from your account page", CodeWords)})
		return
	}
	name := defaultNames[kind]
	if in.Name != nil {
		if n := CleanName(*in.Name); n != "" {
			name = n
		}
	}
	token, hash := s.Tokens.Mint()
	_, dev, err := s.Store.Pair(r.Context(), codeHash(s.CodeKey, code), binding, name, hash, auth.ScopesFor(kind), s.Now())
	switch {
	case errors.Is(err, ErrBadCode):
		bad := badPageCode
		if kind.IsApp() {
			bad = badAppCode
		}
		httpx.WriteInvalid(w, r, map[string]string{"code": bad})
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict,
			fmt.Sprintf(tooMany, MaxDevices), nil)
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "devices: pair", err)
	default:
		httpx.WriteOK(w, r, http.StatusCreated, apitypes.Paired{Token: token, Device: view(dev)})
	}
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.List(r.Context(), auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: list", err)
		return
	}
	out := make([]apitypes.Device, 0, len(list))
	for _, d := range list {
		out = append(out, view(d))
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	workosSID, err := s.Store.Revoke(r.Context(), auth.AccountID(r), id, s.Now())
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: revoke", err)
		return
	}
	if dev, ok := auth.DeviceFrom(r.Context()); ok && dev.ID == id {
		httpx.WriteOK(w, r, http.StatusOK, apitypes.DeviceSignOut{Url: s.logoutURL(r, workosSID)})
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

// logoutURL is the WorkOS logout URL for an app's own sign-out, nil when
// the device kept no WorkOS session or the URL cannot be built (logged:
// the device is unpaired either way, and the app's sheet keeps no
// cookies).
func (s *Service) logoutURL(r *http.Request, workosSID string) *string {
	if workosSID == "" || s.IdP == nil {
		return nil
	}
	u, err := s.IdP.LogoutURL(workosSID, s.SignedOutURL)
	if err != nil {
		s.Log.Warn("devices: logout url", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		return nil
	}
	return &u
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) {
	dev, _ := auth.DeviceFrom(r.Context())
	acct, _ := auth.AccountFrom(r.Context())
	d, err := s.Store.Get(r.Context(), acct.ID, dev.ID)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: me", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.DeviceMe{Device: view(d), Handle: acct.Handle})
}

func view(d Device) apitypes.Device {
	scopes := make([]apitypes.DeviceScope, len(d.Scopes))
	for i, sc := range d.Scopes {
		scopes[i] = apitypes.DeviceScope(sc)
	}
	kind := apitypes.DeviceKind(d.Kind)
	return apitypes.Device{Id: d.ID, Name: d.Name, Kind: &kind, Scopes: scopes, CreatedAt: d.CreatedAt, LastUsedAt: d.LastUsedAt}
}

// CleanName is a browser's name for itself as the account page may show
// it: control and format characters dropped, spaces collapsed, cut at a
// rune to maxNameLen.
func CleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsSpace(r):
			return ' '
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, ""))
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > maxNameLen {
		s = string([]rune(s)[:maxNameLen])
	}
	return strings.TrimSpace(s)
}
