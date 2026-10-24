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
)

// errNotAnApp is an app code asked for a kind that is not an app.
var errNotAnApp = errors.New("devices: app codes are for ios and android")

// Repository is the part of Store the handlers use.
type Repository interface {
	PutCode(ctx context.Context, accountID uuid.UUID, kind auth.DeviceKind, hash []byte, expires time.Time) error
	Pair(ctx context.Context, code []byte, kind auth.DeviceKind, name string, tokenHash []byte, scopes []auth.Scope, now time.Time) (uuid.UUID, Device, error)
	List(ctx context.Context, accountID uuid.UUID) ([]Device, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (Device, error)
	Revoke(ctx context.Context, accountID, id uuid.UUID, now time.Time) error
}

// Minter mints device tokens. *auth.Bearer implements it.
type Minter interface {
	Mint() (token string, hash []byte)
}

// Service serves the device routes.
type Service struct {
	Store  Repository
	Tokens Minter
	// CodeKey keys the pairing codes' stored hashes (PurposeCodes).
	CodeKey []byte
	Now     func() time.Time
	Log     *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/devices/codes", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitCodePerMinute), Handler: s.code},
		{Method: http.MethodPost, Path: "/devices/pair", Access: httpx.Public, Limit: httpx.PerMinute(limitPairPerMinute), Handler: s.pair},
		{Method: http.MethodGet, Path: "/devices", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.list},
		{Method: http.MethodDelete, Path: "/devices/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitRevokePerMinute), Handler: s.revoke},
		{Method: http.MethodGet, Path: "/devices/me", Access: httpx.Device, Scope: string(auth.ScopeLeagueWrite),
			Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.me},
	}
}

// issue stores a fresh code for one kind of device on the account,
// replacing its earlier code, and answers it with when it ends.
func (s *Service) issue(ctx context.Context, accountID uuid.UUID, kind auth.DeviceKind) (string, time.Time, error) {
	code, err := NewCode()
	if err != nil {
		return "", time.Time{}, err
	}
	expires := s.Now().Add(CodeTTL)
	if err := s.Store.PutCode(ctx, accountID, kind, codeHash(s.CodeKey, code), expires); err != nil {
		return "", time.Time{}, err
	}
	return code, expires, nil
}

// AppCode is the code an app's sign-in hands back to the app (auth's
// callback): good for one device of that app's kind, for ten minutes.
func (s *Service) AppCode(ctx context.Context, accountID uuid.UUID, kind auth.DeviceKind) (string, error) {
	if !kind.IsApp() {
		return "", errNotAnApp
	}
	code, _, err := s.issue(ctx, accountID, kind)
	return code, err
}

// code is the account page's code, for the extension.
func (s *Service) code(w http.ResponseWriter, r *http.Request) {
	code, expires, err := s.issue(r.Context(), auth.AccountID(r), auth.KindExtension)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: code", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.PairCode{Code: code, ExpiresAt: expires})
}

// pairKind is the kind a pairing asks for: the extension when it names
// none, as the extension has always paired.
func pairKind(in apitypes.PairInput) (auth.DeviceKind, bool) {
	if in.Kind == nil {
		return auth.KindExtension, true
	}
	return auth.ParseDeviceKind(string(*in.Kind))
}

func (s *Service) pair(w http.ResponseWriter, r *http.Request) {
	var in apitypes.PairInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	kind, ok := pairKind(in)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{"kind": badKind})
		return
	}
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
	_, dev, err := s.Store.Pair(r.Context(), codeHash(s.CodeKey, code), kind, name, hash, auth.ScopesFor(kind), s.Now())
	switch {
	case errors.Is(err, ErrBadCode):
		bad := badPageCode
		if kind.IsApp() {
			bad = badAppCode
		}
		httpx.WriteInvalid(w, r, map[string]string{"code": bad})
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict,
			fmt.Sprintf("Your account has %d paired browsers, the most allowed. Unpair one first", MaxDevices), nil)
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
	err := s.Store.Revoke(r.Context(), auth.AccountID(r), id, s.Now())
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: revoke", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
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
