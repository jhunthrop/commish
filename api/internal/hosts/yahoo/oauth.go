// Package yahoo reads a member's own Yahoo fantasy football leagues as
// them: OAuth 2 authorization code with PKCE (a confidential client, the
// permission Fantasy Sports read only), the tokens kept in the hosts
// vault, and the Fantasy Sports API read in XML, Yahoo's documented form.
// Nothing a caller sends reaches Yahoo but an id this package checked,
// and no token ever reaches a log line or an error.
package yahoo

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Host is this host's key in the connections table and the contract.
const Host = "yahoo"

// DefaultAuthBase is Yahoo's sign-in host, where the authorize page and
// the token endpoint live.
const DefaultAuthBase = "https://api.login.yahoo.com"

// Bounds on a token exchange.
const (
	tokenTimeout = 10 * time.Second
	maxTokenBody = 64 << 10
	maxTokenLen  = 4096
	// verifierBytes is the PKCE verifier's randomness: 32 bytes make the
	// 43-character verifier RFC 7636 asks for at least.
	verifierBytes = 32
	stateBytes    = 32
)

// Errors a token exchange ends in.
var (
	// ErrRefused is Yahoo refusing the code or the refresh token: the
	// member connects again.
	ErrRefused = errors.New("yahoo: token refused")
	// ErrUnavailable is Yahoo not answering, or answering in a way we do
	// not read.
	ErrUnavailable = errors.New("yahoo: not answering")
)

// Tokens is what a token exchange hands back.
type Tokens struct {
	Access  string
	Refresh string
	Expiry  time.Time
}

// Tokens never print: a token in a log line is a token handed out.
func (Tokens) String() string   { return "[redacted]" }
func (Tokens) GoString() string { return "[redacted]" }

// OAuth is the app's registration with Yahoo.
type OAuth struct {
	ClientID     string
	ClientSecret string
	// RedirectURI is exactly the address registered with Yahoo:
	// API_BASE_URL + /hosts/yahoo/callback.
	RedirectURI string
	AuthBase    string
	HTTP        *http.Client
}

// NewOAuth is the registration on Yahoo's own sign-in host. A redirect
// from the token endpoint is never followed.
func NewOAuth(clientID, clientSecret, redirectURI string) *OAuth {
	refuse := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &OAuth{
		ClientID: clientID, ClientSecret: clientSecret, RedirectURI: redirectURI, AuthBase: DefaultAuthBase,
		HTTP: &http.Client{Timeout: tokenTimeout, CheckRedirect: refuse},
	}
}

// Configured reports whether the app's id and secret are present.
func (o *OAuth) Configured() bool {
	return o != nil && o.ClientID != "" && o.ClientSecret != "" && o.RedirectURI != ""
}

// NewVerifier is a fresh PKCE verifier and its S256 challenge.
func NewVerifier() (verifier, challenge string, err error) {
	verifier, err = randomToken(verifierBytes)
	if err != nil {
		return "", "", err
	}
	return verifier, Challenge(verifier), nil
}

// Challenge is a verifier's S256 challenge.
func Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// NewState is a fresh state for the authorize address.
func NewState() (string, error) { return randomToken(stateBytes) }

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("yahoo: random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// AuthorizeURL is Yahoo's authorize page for the state and challenge.
func (o *OAuth) AuthorizeURL(state, challenge string) string {
	q := url.Values{
		"client_id": {o.ClientID}, "redirect_uri": {o.RedirectURI}, "response_type": {"code"},
		"state": {state}, "code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}
	return o.AuthBase + "/oauth2/request_auth?" + q.Encode()
}

// Exchange trades the code Yahoo handed the member for tokens.
func (o *OAuth) Exchange(ctx context.Context, code, verifier string, now time.Time) (Tokens, error) {
	t, err := o.token(ctx, url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {o.RedirectURI}, "code_verifier": {verifier},
	}, now)
	if err != nil {
		return Tokens{}, err
	}
	if t.Refresh == "" {
		return Tokens{}, fmt.Errorf("%w: no refresh token", ErrUnavailable)
	}
	return t, nil
}

// Refresh trades the kept refresh token for a new access token. Yahoo may
// hand back the same refresh token or a new one; with none, the old one
// stands.
func (o *OAuth) Refresh(ctx context.Context, refresh string, now time.Time) (Tokens, error) {
	t, err := o.token(ctx, url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "redirect_uri": {o.RedirectURI},
	}, now)
	if err != nil {
		return Tokens{}, err
	}
	if t.Refresh == "" {
		t.Refresh = refresh
	}
	return t, nil
}

type tokenWire struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// token posts to the token endpoint. Its errors name a status at most,
// never a body: a body may echo what was sent.
func (o *OAuth) token(ctx context.Context, form url.Values, now time.Time) (Tokens, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.AuthBase+"/oauth2/get_token", strings.NewReader(form.Encode()))
	if err != nil {
		return Tokens{}, fmt.Errorf("yahoo: token request: %w", err)
	}
	req.SetBasicAuth(o.ClientID, o.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", UserAgent)
	resp, err := o.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return Tokens{}, ctx.Err()
		}
		return Tokens{}, fmt.Errorf("%w: token endpoint unreachable", ErrUnavailable)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized:
		return Tokens{}, fmt.Errorf("%w: status %d", ErrRefused, resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		return Tokens{}, fmt.Errorf("%w: token endpoint status %d", ErrUnavailable, resp.StatusCode)
	}
	var wire tokenWire
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxTokenBody)).Decode(&wire); err != nil {
		return Tokens{}, fmt.Errorf("%w: token answer does not read", ErrUnavailable)
	}
	if !tokenShaped(wire.AccessToken) || (wire.RefreshToken != "" && !tokenShaped(wire.RefreshToken)) ||
		wire.ExpiresIn <= 0 || wire.ExpiresIn > int((24*time.Hour).Seconds()) {
		return Tokens{}, fmt.Errorf("%w: token answer out of shape", ErrUnavailable)
	}
	return Tokens{Access: wire.AccessToken, Refresh: wire.RefreshToken, Expiry: now.Add(time.Duration(wire.ExpiresIn) * time.Second)}, nil
}

// tokenShaped is a token we will send back in a header: printable ASCII,
// no space, bounded.
func tokenShaped(s string) bool {
	if s == "" || len(s) > maxTokenLen {
		return false
	}
	for _, r := range s {
		if r <= ' ' || r > '~' {
			return false
		}
	}
	return true
}
