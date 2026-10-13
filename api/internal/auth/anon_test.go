package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jhunthrop/commish/api/internal/config"
)

func newTestAnon(t *testing.T) *Anon {
	t.Helper()
	a, err := NewAnon(config.Session{CookiePassword: "anon-test-cookie-password-0123456789abcdef"})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// The anonymous owner's cookies never touch the session's names, so
// minting one cannot clobber a signed-in browser's CSRF token.
func TestAnonIssueSetsOnlyItsOwnCookies(t *testing.T) {
	a := newTestAnon(t)
	w := httptest.NewRecorder()
	hash := a.Issue(w)
	cookies := w.Result().Cookies()
	names := map[string]*http.Cookie{}
	for _, c := range cookies {
		names[c.Name] = c
	}
	if len(cookies) != 2 || names[AnonCookie] == nil || names[AnonCSRFCookie] == nil {
		t.Fatalf("Issue set %v, want exactly %s and %s", cookies, AnonCookie, AnonCSRFCookie)
	}
	if names[SessionCookie] != nil || names[CSRFCookie] != nil {
		t.Fatal("Issue set a session cookie")
	}
	if !names[AnonCookie].HttpOnly || names[AnonCSRFCookie].HttpOnly {
		t.Fatal("the token must be HttpOnly and its CSRF cookie readable")
	}

	r := httptest.NewRequest(http.MethodPost, "/mocks", nil)
	r.AddCookie(names[AnonCookie])
	got, ok := a.Owner(r)
	if !ok || string(got) != string(hash) {
		t.Fatal("the issued cookie does not open to its owner")
	}
	if a.ValidCSRF(r, hash) {
		t.Fatal("a request with no CSRF header passed")
	}
	r.Header.Set(CSRFHeader, names[AnonCSRFCookie].Value)
	if a.ValidCSRF(r, hash) {
		t.Fatal("the anonymous token was accepted in the session's header")
	}
	r.Header.Set(AnonCSRFHeader, names[AnonCSRFCookie].Value)
	if !a.ValidCSRF(r, hash) {
		t.Fatal("the anonymous CSRF token was refused in its own header")
	}
}

func TestAnonClearExpiresBothCookies(t *testing.T) {
	a := newTestAnon(t)
	w := httptest.NewRecorder()
	a.Clear(w)
	for _, c := range w.Result().Cookies() {
		if c.Name != AnonCookie && c.Name != AnonCSRFCookie {
			t.Fatalf("Clear touched %s", c.Name)
		}
		if c.MaxAge >= 0 {
			t.Fatalf("%s not expired", c.Name)
		}
	}
}

func TestCrossSite(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/mocks", nil)
	if CrossSite(r) {
		t.Fatal("no Sec-Fetch-Site read as cross-site")
	}
	r.Header.Set("Sec-Fetch-Site", "same-site")
	if CrossSite(r) {
		t.Fatal("same-site read as cross-site")
	}
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if !CrossSite(r) {
		t.Fatal("cross-site not seen")
	}
}
