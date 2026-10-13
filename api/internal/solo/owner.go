package solo

import (
	"net/http"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/mocks"
)

// MaxLiveAnonymous is how many unfinished mocks one signed-out browser
// may keep; signing in claims them and lifts the cap.
const MaxLiveAnonymous = 25

// AnonOwners issues and reads the signed-out owner's cookies.
// *auth.Anon implements it.
type AnonOwners interface {
	Owner(r *http.Request) ([]byte, bool)
	Issue(w http.ResponseWriter) []byte
	ValidCSRF(r *http.Request, hash []byte) bool
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// owner is who a request drafts as: the signed-in account, else this
// browser's anonymous token, which a first create mints. A state-changing
// request from an anonymous owner carries the CSRF token bound to it, the
// way a session's request does. On false it has already answered.
func (s *Service) owner(w http.ResponseWriter, r *http.Request, mint bool) (mocks.Owner, bool) {
	if a, ok := auth.AccountFrom(r.Context()); ok {
		return mocks.AccountOwner(a.ID), true
	}
	if hash, ok := s.Anon.Owner(r); ok {
		if !safeMethod(r.Method) && !s.Anon.ValidCSRF(r, hash) {
			httpx.WriteError(w, r, http.StatusForbidden, httpx.CodeCSRF, "Reload the page and try again", nil)
			return mocks.Owner{}, false
		}
		return mocks.TokenOwner(hash), true
	}
	if mint {
		return mocks.TokenOwner(s.Anon.Issue(w)), true
	}
	httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "This mock was started in another browser. Sign in to see your mocks", nil)
	return mocks.Owner{}, false
}
