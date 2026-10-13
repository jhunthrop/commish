package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/config"
)

// The anonymous owner: a browser that drafts a solo mock signed out
// (coordinator ruling, Lane 6 fix round 1). A random token sealed in its
// own HttpOnly cookie on the apex domain, its sha256 the mock's owner, a
// CSRF token derived from that hash in commish_csrf as a session's is,
// and the token's mocks moved to the account at sign-in.
const (
	AnonCookie = "commish_anon"
	// AnonTTL is the anonymous cookie's life, and how long an unclaimed
	// mock is kept after its last change.
	AnonTTL     = 90 * 24 * time.Hour
	purposeAnon = "commish anon v1"
)

// Anon issues and reads the anonymous owner's cookies.
type Anon struct {
	cookies config.Session
	seal    *Sealer
	csrf    *CSRFSigner
}

// NewAnon derives the anonymous cookie's keys from the cookie password.
func NewAnon(cfg config.Session) (*Anon, error) {
	seal, err := NewSealer(cfg.CookiePassword, purposeAnon)
	if err != nil {
		return nil, err
	}
	csrf, err := NewCSRFSigner(cfg.CookiePassword)
	if err != nil {
		return nil, err
	}
	return &Anon{cookies: cfg, seal: seal, csrf: csrf}, nil
}

func (a *Anon) cookie(name, value string, maxAge int, httpOnly bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: "/", Domain: a.cookies.CookieDomain, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: a.cookies.CookieSecure, SameSite: http.SameSiteLaxMode,
	}
}

// Owner is the request's anonymous owner hash, false without a cookie
// that opens.
func (a *Anon) Owner(r *http.Request) ([]byte, bool) {
	c, err := r.Cookie(AnonCookie)
	if err != nil || c.Value == "" {
		return nil, false
	}
	token, err := a.seal.Open(c.Value)
	if err != nil {
		return nil, false
	}
	return hashToken(token), true
}

// Issue mints an anonymous owner and sets its cookies; the hash is the owner.
func (a *Anon) Issue(w http.ResponseWriter) []byte {
	token, hash := newToken()
	maxAge := int(AnonTTL / time.Second)
	http.SetCookie(w, a.cookie(AnonCookie, a.seal.Seal(token), maxAge, true))
	http.SetCookie(w, a.cookie(CSRFCookie, a.csrf.Token(hash), maxAge, false))
	return hash
}

// ValidCSRF reports whether a state-changing request carries the CSRF
// token bound to this anonymous owner.
func (a *Anon) ValidCSRF(r *http.Request, hash []byte) bool {
	return a.csrf.Valid(hash, r.Header.Get(CSRFHeader))
}

// Clear expires the anonymous cookie (the session's CSRF cookie, set at
// sign-in, stays).
func (a *Anon) Clear(w http.ResponseWriter) {
	http.SetCookie(w, a.cookie(AnonCookie, "", -1, true))
}

// AnonClaimer moves an anonymous owner's mocks to an account.
// *mocks.Store implements it.
type AnonClaimer interface {
	Claim(ctx context.Context, accountID uuid.UUID, ownerToken []byte) (int64, error)
}
