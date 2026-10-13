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
// CSRF token derived from that hash in its own readable cookie (never the
// session's commish_csrf, so minting one cannot clobber a session's), and
// the token's mocks moved to the account at sign-in.
const (
	AnonCookie     = "commish_anon"
	AnonCSRFCookie = "commish_anon_csrf"
	// AnonCSRFHeader carries the anonymous CSRF token, apart from the
	// session's X-CSRF-Token, so a stale session cookie never stands in
	// for the anonymous owner's.
	AnonCSRFHeader = "X-Anon-CSRF-Token"
	// AnonTTL is the anonymous cookie's life, and how long an unclaimed
	// mock is kept after its last change.
	AnonTTL = 90 * 24 * time.Hour
	// AnonEmptyTTL is how long an unclaimed mock nobody drafted in is kept.
	AnonEmptyTTL = 24 * time.Hour
	purposeAnon  = "commish anon v1"
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

// Issue mints an anonymous owner and sets its two cookies; the hash is
// the owner. The caller mints only for a request with no valid session
// and no valid anonymous cookie, after its input validated.
func (a *Anon) Issue(w http.ResponseWriter) []byte {
	token, hash := newToken()
	maxAge := int(AnonTTL / time.Second)
	http.SetCookie(w, a.cookie(AnonCookie, a.seal.Seal(token), maxAge, true))
	http.SetCookie(w, a.cookie(AnonCSRFCookie, a.csrf.Token(hash), maxAge, false))
	return hash
}

// CrossSite reports whether the browser says the request came from
// another site (Sec-Fetch-Site); such a request never mints an owner.
func CrossSite(r *http.Request) bool {
	return r.Header.Get("Sec-Fetch-Site") == "cross-site"
}

// ValidCSRF reports whether a state-changing request carries the CSRF
// token bound to this anonymous owner.
func (a *Anon) ValidCSRF(r *http.Request, hash []byte) bool {
	return a.csrf.Valid(hash, r.Header.Get(AnonCSRFHeader))
}

// Clear expires both anonymous cookies at sign-in; the session's own
// CSRF cookie is untouched.
func (a *Anon) Clear(w http.ResponseWriter) {
	http.SetCookie(w, a.cookie(AnonCookie, "", -1, true))
	http.SetCookie(w, a.cookie(AnonCSRFCookie, "", -1, false))
}

// AnonClaimer moves an anonymous owner's mocks to an account.
// *mocks.Store implements it.
type AnonClaimer interface {
	Claim(ctx context.Context, accountID uuid.UUID, ownerToken []byte) (int64, error)
}
