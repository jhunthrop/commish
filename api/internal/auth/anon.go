package auth

import (
	"context"
	"net/http"
	"slices"
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
	// trusted is the API's CORS allow-list: a page on one of these origins
	// is one of ours even when the browser calls it another site (a
	// preview host), so it may start a signed-out mock.
	trusted []string
}

// NewAnon derives the anonymous cookie's keys from the cookie password.
// trusted is the CORS allow-list (CORS_ORIGINS).
func NewAnon(cfg config.Session, trusted []string) (*Anon, error) {
	seal, err := NewSealer(cfg.CookiePassword, purposeAnon)
	if err != nil {
		return nil, err
	}
	csrf, err := NewCSRFSigner(cfg.CookiePassword)
	if err != nil {
		return nil, err
	}
	return &Anon{cookies: cfg, seal: seal, csrf: csrf, trusted: slices.Clone(trusted)}, nil
}

// cookie is one of the anonymous cookies. A page on a trusted origin that
// the browser calls another site keeps and sends only a SameSite=None
// cookie, so there the cookie is None, Secure and Partitioned: held under
// that page's own site and never sent from any other.
func (a *Anon) cookie(name, value string, maxAge int, httpOnly, crossSite bool) *http.Cookie {
	c := &http.Cookie{
		Name: name, Value: value, Path: "/", Domain: a.cookies.CookieDomain, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: a.cookies.CookieSecure, SameSite: http.SameSiteLaxMode,
	}
	if crossSite {
		c.SameSite, c.Secure, c.Partitioned = http.SameSiteNoneMode, true, true
	}
	return c
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
// and no valid anonymous cookie, after its input validated and Admits
// passed.
func (a *Anon) Issue(w http.ResponseWriter, r *http.Request) []byte {
	token, hash := newToken()
	maxAge := int(AnonTTL / time.Second)
	cross := CrossSite(r)
	http.SetCookie(w, a.cookie(AnonCookie, a.seal.Seal(token), maxAge, true, cross))
	http.SetCookie(w, a.cookie(AnonCSRFCookie, a.csrf.Token(hash), maxAge, false, cross))
	return hash
}

// CrossSite reports whether the browser says the request came from
// another site (Sec-Fetch-Site).
func CrossSite(r *http.Request) bool {
	return r.Header.Get("Sec-Fetch-Site") == "cross-site"
}

// trustedOrigin reports whether the request's Origin is on the allow-list.
func (a *Anon) trustedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin != "" && slices.Contains(a.trusted, origin)
}

// Admits reports whether a request may mint an anonymous owner: one the
// browser does not call cross-site, or a cross-site one whose Origin is on
// the allow-list. Any other cross-site request, an absent Origin included,
// never mints, so another site cannot plant or replace this browser's
// cookies.
func (a *Anon) Admits(r *http.Request) bool {
	return !CrossSite(r) || a.trustedOrigin(r)
}

// ValidCSRF reports whether a state-changing request is the anonymous
// owner's own: it carries the CSRF token bound to the owner, or it comes
// cross-site from a trusted origin, whose page cannot read this site's
// CSRF cookie and whose Origin header no other page can send.
func (a *Anon) ValidCSRF(r *http.Request, hash []byte) bool {
	if CrossSite(r) && a.trustedOrigin(r) {
		return true
	}
	return a.csrf.Valid(hash, r.Header.Get(AnonCSRFHeader))
}

// Clear expires both anonymous cookies at sign-in; the session's own
// CSRF cookie is untouched.
func (a *Anon) Clear(w http.ResponseWriter) {
	http.SetCookie(w, a.cookie(AnonCookie, "", -1, true, false))
	http.SetCookie(w, a.cookie(AnonCSRFCookie, "", -1, false, false))
}

// AnonClaimer moves an anonymous owner's mocks to an account.
// *mocks.Store implements it.
type AnonClaimer interface {
	Claim(ctx context.Context, accountID uuid.UUID, ownerToken []byte) (int64, error)
}
