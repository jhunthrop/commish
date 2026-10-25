package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Cookie and header names, the contract with the web lane.
const (
	SessionCookie = "commish_session"
	CSRFCookie    = "commish_csrf"
	CSRFHeader    = "X-CSRF-Token"
)

// SignInMessage is what a signed-out request is told, on a 401 and on the
// room's error frame before it closes a socket whose device signed out.
const SignInMessage = "Sign in to do that"

type ctxKey int

const accountKey ctxKey = 1

// WithAccount puts the signed-in account on a context.
func WithAccount(ctx context.Context, a Account) context.Context {
	return context.WithValue(ctx, accountKey, a)
}

// AccountFrom reads the signed-in account. ok is false when signed out.
func AccountFrom(ctx context.Context) (Account, bool) {
	a, ok := ctx.Value(accountKey).(Account)
	return a, ok
}

// AccountID is the signed-in account's id, for handlers on SignedIn
// routes, where RequireSession has already refused a signed-out
// request. It is uuid.Nil otherwise.
func AccountID(r *http.Request) uuid.UUID {
	a, _ := AccountFrom(r.Context())
	return a.ID
}

// SessionReader is the part of Store the middleware needs.
type SessionReader interface {
	SessionAccount(ctx context.Context, tokenHash []byte, now time.Time) (Account, bool, error)
}

// Sessions owns the session and CSRF cookies: issuing, reading and
// clearing them. The api and the room share it; only the api issues.
type Sessions struct {
	cookies config.Session
	seal    *Sealer
	csrf    *CSRFSigner
	store   SessionReader
	now     func() time.Time
	log     *slog.Logger
	// trustedHops is TRUSTED_PROXY_HOPS, for the signed-out rate key.
	trustedHops int
}

// NewSessions derives the session and CSRF keys from the cookie
// password.
func NewSessions(cfg config.Session, trustedHops int, store SessionReader, now func() time.Time, log *slog.Logger) (*Sessions, error) {
	seal, err := NewSealer(cfg.CookiePassword, purposeSession)
	if err != nil {
		return nil, err
	}
	csrf, err := NewCSRFSigner(cfg.CookiePassword)
	if err != nil {
		return nil, err
	}
	return &Sessions{cookies: cfg, seal: seal, csrf: csrf, store: store, now: now, log: log, trustedHops: trustedHops}, nil
}

func (s *Sessions) cookie(name, value string, maxAge int, httpOnly bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: "/", Domain: s.cookies.CookieDomain, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: s.cookies.CookieSecure, SameSite: http.SameSiteLaxMode,
	}
}

// Issue sets the session cookie (the sealed token) and the CSRF cookie
// (readable by the site's script, so it can echo it in X-CSRF-Token).
func (s *Sessions) Issue(w http.ResponseWriter, token []byte) {
	maxAge := int(SessionTTL / time.Second)
	http.SetCookie(w, s.cookie(SessionCookie, s.seal.Seal(token), maxAge, true))
	http.SetCookie(w, s.cookie(CSRFCookie, s.csrf.Token(hashToken(token)), maxAge, false))
}

// Clear expires both cookies.
func (s *Sessions) Clear(w http.ResponseWriter) {
	http.SetCookie(w, s.cookie(SessionCookie, "", -1, true))
	http.SetCookie(w, s.cookie(CSRFCookie, "", -1, false))
}

// Token opens the request's session cookie. ok is false when there is
// none or it does not open.
func (s *Sessions) Token(r *http.Request) ([]byte, bool) {
	c, err := r.Cookie(SessionCookie)
	if err != nil || c.Value == "" {
		return nil, false
	}
	token, err := s.seal.Open(c.Value)
	if err != nil {
		return nil, false
	}
	return token, true
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// Middleware resolves the account behind the session cookie and puts it
// on the context. It never refuses a signed-out request (RequireSession
// does that per route), but it refuses a state-changing request that
// carries a session without the CSRF token bound to it.
func (s *Sessions) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := s.Token(r)
		if !ok {
			if _, err := r.Cookie(SessionCookie); err == nil {
				s.Clear(w)
			}
			next.ServeHTTP(w, r)
			return
		}
		hash := hashToken(token)
		if !safeMethod(r.Method) && !s.csrf.Valid(hash, r.Header.Get(CSRFHeader)) {
			httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeCSRF, "Reload the page and try again", nil)
			return
		}
		acct, renewed, err := s.store.SessionAccount(r.Context(), hash, s.now())
		switch {
		case errors.Is(err, ErrNoSession):
			s.Clear(w)
			next.ServeHTTP(w, r)
			return
		case err != nil:
			httpx.WriteInternal(w, r, s.log, "auth: session", err)
			return
		}
		if renewed {
			s.Issue(w, token)
		}
		next.ServeHTTP(w, r.WithContext(WithAccount(r.Context(), acct)))
	})
}

// RequireSession answers 401 for a signed-out request.
func RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := AccountFrom(r.Context()); !ok {
			httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, SignInMessage, nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateKey keys a rate limit without touching the database: by the
// session token when the cookie opens (only we can seal one, so a
// flood cannot mint fresh keys that way), and by the client address
// otherwise, IPv6 by its /64. One drafter on a shared address is not
// limited by a neighbor, and a signed-out flood is still bounded.
func (s *Sessions) RateKey(r *http.Request) string {
	if token, ok := s.Token(r); ok {
		sum := sha256.Sum256(token)
		return "s:" + hex.EncodeToString(sum[:16])
	}
	return "ip:" + httpx.AddressKey(httpx.ClientIP(r, s.trustedHops))
}
