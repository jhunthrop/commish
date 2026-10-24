package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/httpx"
)

// The bearer path (spec §2.8): a paired device, the browser extension
// first, sends a scoped token in Authorization: Bearer instead of the
// session cookie. A device token is never a cookie, so no CSRF token
// rides with it: nothing a browser sends on its own carries it. The
// extension's token opens only the routes that name one of its scopes
// (httpx.Device). An app's token (iOS, Android: the mobile spec §5.2)
// also carries ScopeSession, which opens the session's routes as its
// account (SessionOr). Every token is revoked from the account page.

// Scope is what a device token may do.
type Scope string

// The scopes: league pages, draft picks, and the whole signed-in surface.
const (
	ScopeLeagueWrite Scope = "league:write"
	ScopeDraftWrite  Scope = "draft:write"
	ScopeSession     Scope = "session"
)

// DeviceKind is what was paired: the browser extension or an app.
type DeviceKind string

// The kinds. The words are a contract with the apps (/auth/login's
// client, PairInput's kind) and with the devices table's check.
const (
	KindExtension DeviceKind = "extension"
	KindIOS       DeviceKind = "ios"
	KindAndroid   DeviceKind = "android"
)

// ParseDeviceKind reads one of the three words exactly.
func ParseDeviceKind(raw string) (DeviceKind, bool) {
	switch k := DeviceKind(raw); k {
	case KindExtension, KindIOS, KindAndroid:
		return k, true
	}
	return "", false
}

// IsApp reports whether the kind is a phone app: the kinds that sign in
// through /auth/login and carry the session scope.
func (k DeviceKind) IsApp() bool { return k == KindIOS || k == KindAndroid }

// ScopesFor is what a device of kind is minted with: an app the session
// besides the extension's two, the extension only its two.
func ScopesFor(kind DeviceKind) []Scope {
	if kind.IsApp() {
		return []Scope{ScopeSession, ScopeLeagueWrite, ScopeDraftWrite}
	}
	return []Scope{ScopeLeagueWrite, ScopeDraftWrite}
}

// Device is a paired device as a request carries it.
type Device struct {
	ID        uuid.UUID
	AccountID uuid.UUID
	Scopes    []Scope
}

// Has reports whether the device carries scope.
func (d Device) Has(scope Scope) bool { return slices.Contains(d.Scopes, scope) }

// ErrNoDevice is a token no live device holds: unknown or revoked.
var ErrNoDevice = errors.New("auth: no such device")

// DeviceReader resolves a token's hash to its device and account.
// devices.Store implements it.
type DeviceReader interface {
	DeviceAccount(ctx context.Context, tokenHash []byte, now time.Time) (Account, Device, error)
}

const deviceKey ctxKey = 2

// WithDevice puts a device on a context, as Require does.
func WithDevice(ctx context.Context, d Device) context.Context {
	return context.WithValue(ctx, deviceKey, d)
}

// DeviceFrom is the device a bearer request came from.
func DeviceFrom(ctx context.Context) (Device, bool) {
	d, ok := ctx.Value(deviceKey).(Device)
	return d, ok
}

// Token shape: "cmd1." + base64url(32 random bytes) + "." +
// base64url(HMAC-SHA256(key, random)[:macLen]). The MAC lets a rate key
// and a refusal be decided with no database read, so a flood of made-up
// tokens costs nothing and mints no fresh rate keys.
const (
	tokenPrefix     = "cmd1."
	tokenRandomLen  = 32
	tokenMACLen     = 12
	purposeDevice   = "commish device token v1"
	bearerScheme    = "Bearer "
	maxBearerHeader = 200
)

// Bearer mints and checks device tokens.
type Bearer struct {
	key         []byte
	store       DeviceReader
	now         func() time.Time
	log         *slog.Logger
	trustedHops int
}

// NewBearer derives the device token key from the cookie password.
func NewBearer(password string, trustedHops int, store DeviceReader, now func() time.Time, log *slog.Logger) (*Bearer, error) {
	key, err := DeriveKey(password, purposeDevice)
	if err != nil {
		return nil, err
	}
	return &Bearer{key: key, store: store, now: now, log: log, trustedHops: trustedHops}, nil
}

func (b *Bearer) mac(random []byte) []byte {
	m := hmac.New(sha256.New, b.key)
	m.Write(random)
	return m.Sum(nil)[:tokenMACLen]
}

// Mint is a new device token and the hash the table keeps. The token is
// answered once, at pairing, and never stored.
func (b *Bearer) Mint() (token string, hash []byte) {
	random := make([]byte, tokenRandomLen)
	_, _ = rand.Read(random)
	enc := base64.RawURLEncoding
	token = tokenPrefix + enc.EncodeToString(random) + "." + enc.EncodeToString(b.mac(random))
	return token, TokenHash(token)
}

// TokenHash is the stored form of a device token.
func TokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// parse is the request's device token, when it carries one with our MAC.
func (b *Bearer) parse(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if len(h) > maxBearerHeader || !strings.HasPrefix(h, bearerScheme) {
		return "", false
	}
	token := strings.TrimSpace(h[len(bearerScheme):])
	rest, ok := strings.CutPrefix(token, tokenPrefix)
	if !ok {
		return "", false
	}
	randomPart, macPart, ok := strings.Cut(rest, ".")
	if !ok {
		return "", false
	}
	random, err := base64.RawURLEncoding.DecodeString(randomPart)
	if err != nil || len(random) != tokenRandomLen {
		return "", false
	}
	mac, err := base64.RawURLEncoding.DecodeString(macPart)
	if err != nil || !hmac.Equal(mac, b.mac(random)) {
		return "", false
	}
	return token, true
}

// RateKey keys a device route's limit by its token when the MAC holds,
// by the address otherwise, with no database read.
func (b *Bearer) RateKey(r *http.Request) string {
	if key, ok := b.TokenKey(r); ok {
		return key
	}
	return "ip:" + httpx.AddressKey(httpx.ClientIP(r, b.trustedHops))
}

// TokenKey is a rate key for the request's token when it carries one
// whose MAC holds, read with no database read.
func (b *Bearer) TokenKey(r *http.Request) (string, bool) {
	token, ok := b.parse(r)
	if !ok {
		return "", false
	}
	return "d:" + hex.EncodeToString(TokenHash(token)[:16]), true
}

// SessionOr serves a session route (httpx.SignedIn, httpx.Public). A
// request whose token is a live device carrying ScopeSession goes to
// signedIn with that device's account and the device on its context: the
// cookie is not read and no CSRF token is asked for, since nothing a
// browser sends on its own carries the header. Every other request goes
// to cookie, the session path, unchanged: no token, a token that is not
// ours, an unknown or revoked one, and the extension's, which never
// carries the scope. Only a well-formed token costs a device read.
func (b *Bearer) SessionOr(signedIn, cookie http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := b.parse(r)
		if !ok {
			cookie.ServeHTTP(w, r)
			return
		}
		acct, dev, err := b.store.DeviceAccount(r.Context(), TokenHash(token), b.now())
		switch {
		case errors.Is(err, ErrNoDevice), err == nil && !dev.Has(ScopeSession):
			cookie.ServeHTTP(w, r)
			return
		case err != nil:
			httpx.WriteInternal(w, r, b.log, "auth: device session", err)
			return
		}
		ctx := WithDevice(WithAccount(r.Context(), acct), dev)
		signedIn.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Require resolves the request's device and its account and refuses a
// request without a live token (401) or without scope (403). A cookie on
// the same request is ignored: a device route reads only the token.
func (b *Bearer) Require(scope Scope) httpx.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := b.parse(r)
			if !ok {
				writePairAgain(w, r)
				return
			}
			acct, dev, err := b.store.DeviceAccount(r.Context(), TokenHash(token), b.now())
			switch {
			case errors.Is(err, ErrNoDevice):
				writePairAgain(w, r)
				return
			case err != nil:
				httpx.WriteInternal(w, r, b.log, "auth: device", err)
				return
			case !dev.Has(scope):
				httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeForbidden, "This browser is not paired for that", nil)
				return
			}
			ctx := WithDevice(WithAccount(r.Context(), acct), dev)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writePairAgain(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Pair this browser again from your account page", nil)
}
