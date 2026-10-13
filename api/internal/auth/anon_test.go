package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jhunthrop/commish/api/internal/config"
)

// previewOrigin is a trusted origin on another site, as a preview host is.
const previewOrigin = "https://commish-web.example.workers.dev"

func newTestAnon(t *testing.T) *Anon {
	t.Helper()
	a, err := NewAnon(config.Session{CookiePassword: "anon-test-cookie-password-0123456789abcdef"}, []string{previewOrigin})
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
	hash := a.Issue(w, httptest.NewRequest(http.MethodPost, "/mocks", nil))
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
	for _, c := range cookies {
		if c.SameSite != http.SameSiteLaxMode || c.Partitioned {
			t.Fatalf("%s from this site must be SameSite=Lax and unpartitioned, got %v partitioned=%v", c.Name, c.SameSite, c.Partitioned)
		}
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

func crossSiteRequest(origin string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/mocks", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

// A cross-site start mints only from an origin on the allow-list; a page
// on any other site, or a request with no Origin, never does.
func TestAnonAdmits(t *testing.T) {
	a := newTestAnon(t)
	sameSite := httptest.NewRequest(http.MethodPost, "/mocks", nil)
	sameSite.Header.Set("Sec-Fetch-Site", "same-site")
	cases := []struct {
		name string
		r    *http.Request
		want bool
	}{
		{"no fetch metadata", httptest.NewRequest(http.MethodPost, "/mocks", nil), true},
		{"same site", sameSite, true},
		{"cross-site from the allow-list", crossSiteRequest(previewOrigin), true},
		{"cross-site from another origin", crossSiteRequest("https://evil.example"), false},
		{"cross-site with no Origin", crossSiteRequest(""), false},
		{"cross-site from a lookalike", crossSiteRequest(previewOrigin + ".evil.example"), false},
	}
	for _, c := range cases {
		if got := a.Admits(c.r); got != c.want {
			t.Errorf("%s: Admits = %v, want %v", c.name, got, c.want)
		}
	}
}

// A trusted cross-site page keeps its cookies only as SameSite=None, so
// they are minted None, Secure and Partitioned.
func TestAnonIssueCrossSiteIsPartitioned(t *testing.T) {
	a := newTestAnon(t)
	w := httptest.NewRecorder()
	a.Issue(w, crossSiteRequest(previewOrigin))
	cookies := w.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("Issue set %d cookies, want 2", len(cookies))
	}
	for _, c := range cookies {
		if c.SameSite != http.SameSiteNoneMode || !c.Secure || !c.Partitioned {
			t.Fatalf("%s cross-site: SameSite %v Secure %v Partitioned %v, want None, true, true", c.Name, c.SameSite, c.Secure, c.Partitioned)
		}
	}
}

// A trusted cross-site page cannot read the CSRF cookie, so its Origin is
// the proof; any other cross-site page still needs the token.
func TestAnonValidCSRFCrossSite(t *testing.T) {
	a := newTestAnon(t)
	w := httptest.NewRecorder()
	hash := a.Issue(w, httptest.NewRequest(http.MethodPost, "/mocks", nil))
	if !a.ValidCSRF(crossSiteRequest(previewOrigin), hash) {
		t.Fatal("a trusted cross-site page was refused")
	}
	if a.ValidCSRF(crossSiteRequest("https://evil.example"), hash) {
		t.Fatal("an untrusted cross-site page passed without the token")
	}
	if a.ValidCSRF(crossSiteRequest(""), hash) {
		t.Fatal("a cross-site request with no Origin passed without the token")
	}
	sameSite := httptest.NewRequest(http.MethodPost, "/mocks", nil)
	sameSite.Header.Set("Origin", previewOrigin)
	if a.ValidCSRF(sameSite, hash) {
		t.Fatal("a same-site request passed on its Origin alone")
	}
}
