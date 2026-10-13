package solo

import (
	"net/http"
	"net/url"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/mocks"
)

// Signed-out caps. One browser keeps at most MaxLiveAnonymous unfinished
// mocks (signing in claims them and lifts the cap); every signed-out
// browser together starts at most MaxAnonymousPerHour mocks an hour,
// counted in app.anon_mock_hours across every instance; the route's
// per-IP bucket stays in front of both.
const (
	MaxLiveAnonymous    = 25
	MaxAnonymousPerHour = 2000
)

// AnonOwners issues and reads the signed-out owner's cookies.
// *auth.Anon implements it.
type AnonOwners interface {
	Owner(r *http.Request) ([]byte, bool)
	Issue(w http.ResponseWriter, r *http.Request) []byte
	ValidCSRF(r *http.Request, hash []byte) bool
	Admits(r *http.Request) bool
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// current is who a request drafts as, never minting: the signed-in
// account, else this browser's anonymous token. A state-changing request
// from an anonymous owner carries the CSRF token bound to it, the way a
// session's request does. found is false when the request has neither;
// on !ok it has already answered.
func (s *Service) current(w http.ResponseWriter, r *http.Request) (owner mocks.Owner, found, ok bool) {
	if a, signedIn := auth.AccountFrom(r.Context()); signedIn {
		return mocks.AccountOwner(a.ID), true, true
	}
	hash, has := s.Anon.Owner(r)
	if !has {
		return mocks.Owner{}, false, true
	}
	if !safeMethod(r.Method) && !s.Anon.ValidCSRF(r, hash) {
		httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeCSRF, "Reload the page and try again", nil)
		return mocks.Owner{}, false, false
	}
	return mocks.TokenOwner(hash), true, true
}

// owner is the request's owner for a route on an existing mock: a
// request with neither a session nor an anonymous cookie answers 401.
func (s *Service) owner(w http.ResponseWriter, r *http.Request) (mocks.Owner, bool) {
	owner, found, ok := s.current(w, r)
	if !ok {
		return mocks.Owner{}, false
	}
	if !found {
		httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "This mock was started in another browser. Sign in to see your mocks", nil)
		return mocks.Owner{}, false
	}
	return owner, true
}

// mint issues a new anonymous owner for a create whose input has
// validated and whose request had no valid session or token. A cross-site
// request mints only from an origin on the allow-list, so another site
// cannot plant or replace this browser's cookies. On false it has already
// answered with where a signed-out mock does start: the sentence, and the
// site's address in the field "site".
func (s *Service) mint(w http.ResponseWriter, r *http.Request) (mocks.Owner, bool) {
	if !s.Anon.Admits(r) {
		httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeForbidden, startHere(s.Site), map[string]string{refusedSiteField: s.Site})
		return mocks.Owner{}, false
	}
	return mocks.TokenOwner(s.Anon.Issue(w, r)), true
}

// refusedSiteField names the site a refused signed-out start points to.
const refusedSiteField = "site"

// startHere is the refusal's sentence: where a signed-out mock starts.
func startHere(site string) string {
	if u, err := url.Parse(site); err == nil && u.Host != "" {
		return "Mocks start on " + u.Host
	}
	return "Mocks start on our own site"
}

// admitAnonymous applies the signed-out caps to a create: the browser's
// live mocks (when it has a token already), then the hour's count across
// every signed-out browser. On false it has already answered.
func (s *Service) admitAnonymous(w http.ResponseWriter, r *http.Request, owner mocks.Owner, found bool) bool {
	if found {
		live, err := s.Mocks.LiveAnonymous(r.Context(), owner.Token)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "solo: count anonymous", err)
			return false
		}
		if live >= MaxLiveAnonymous {
			httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict,
				"Sign in to keep more than 25 mocks going at once", nil)
			return false
		}
	}
	n, err := s.Mocks.CountAnonymousStart(r.Context(), s.now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "solo: count anonymous starts", err)
		return false
	}
	if n > MaxAnonymousPerHour {
		httpx.WriteError(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
			"A lot of people are drafting signed out right now. Sign in to start a mock.", nil)
		return false
	}
	return true
}
