package yahoo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// The authorize address carries the app, the exact registered callback,
// the state and an S256 challenge, and nothing secret.
func TestAuthorizeURL(t *testing.T) {
	o := NewOAuth("app-id", "app-secret", "https://api.trycommish.app/hosts/yahoo/callback")
	verifier, challenge, err := NewVerifier()
	if err != nil {
		t.Fatal(err)
	}
	if len(verifier) < 43 || Challenge(verifier) != challenge {
		t.Fatalf("verifier of %d characters, challenge %q", len(verifier), challenge)
	}
	u, err := url.Parse(o.AuthorizeURL("the-state", challenge))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Host != "api.login.yahoo.com" || u.Path != "/oauth2/request_auth" || q.Get("client_id") != "app-id" ||
		q.Get("redirect_uri") != "https://api.trycommish.app/hosts/yahoo/callback" || q.Get("state") != "the-state" ||
		q.Get("code_challenge") != challenge || q.Get("code_challenge_method") != "S256" || q.Get("response_type") != "code" {
		t.Fatalf("authorize address %s", u)
	}
	if strings.Contains(u.String(), "app-secret") || strings.Contains(u.String(), verifier) {
		t.Fatal("the authorize address carries a secret")
	}
}

func tokenServer(t *testing.T, status int, body string, seen *url.Values) *OAuth {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, secret, ok := r.BasicAuth()
		if !ok || id != "app-id" || secret != "app-secret" || r.URL.Path != "/oauth2/get_token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if seen != nil {
			*seen = r.PostForm
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	o := NewOAuth("app-id", "app-secret", "https://api.trycommish.app/hosts/yahoo/callback")
	o.AuthBase = srv.URL
	return o
}

// A code is exchanged with the verifier and the registered callback; the
// tokens and their expiry come back.
func TestExchange(t *testing.T) {
	var seen url.Values
	o := tokenServer(t, http.StatusOK, string(fixture(t, "yahoo-token.json")), &seen)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	tok, err := o.Exchange(context.Background(), "the-code", "the-verifier", now)
	if err != nil {
		t.Fatal(err)
	}
	if tok.Access != "fixture-access-token-A" || tok.Refresh != "fixture-refresh-token-R" || !tok.Expiry.Equal(now.Add(time.Hour)) {
		t.Fatalf("tokens: access %q, expiry %v", tok.Access, tok.Expiry)
	}
	if seen.Get("grant_type") != "authorization_code" || seen.Get("code") != "the-code" || seen.Get("code_verifier") != "the-verifier" ||
		seen.Get("redirect_uri") != o.RedirectURI {
		t.Fatalf("form sent: %v", seen)
	}
	if s := tok.String(); strings.Contains(s, "fixture") {
		t.Fatalf("tokens print as %q", s)
	}
}

// A refused refresh is ErrRefused, and neither error carries what was
// sent or answered.
func TestRefreshRefusedNamesNoToken(t *testing.T) {
	o := tokenServer(t, http.StatusBadRequest, `{"error":"invalid_grant","error_description":"echo fixture-refresh-token-R"}`, nil)
	_, err := o.Refresh(context.Background(), "fixture-refresh-token-R", time.Now())
	if !errors.Is(err, ErrRefused) {
		t.Fatalf("refused refresh: %v", err)
	}
	if strings.Contains(err.Error(), "fixture") {
		t.Fatalf("the error carries a token: %v", err)
	}
	o = tokenServer(t, http.StatusOK, `{"access_token":"","expires_in":3600}`, nil)
	if _, err := o.Refresh(context.Background(), "r", time.Now()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("an answer with no token: %v", err)
	}
}

// A refresh Yahoo answers without a new refresh token keeps the old one.
func TestRefreshKeepsTheRefreshToken(t *testing.T) {
	o := tokenServer(t, http.StatusOK, `{"access_token":"new-access","expires_in":3600}`, nil)
	tok, err := o.Refresh(context.Background(), "kept-refresh", time.Now())
	if err != nil || tok.Access != "new-access" || tok.Refresh != "kept-refresh" {
		t.Fatalf("%v", err)
	}
}
