package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/workos/workos-go/v4/pkg/usermanagement"
	"github.com/workos/workos-go/v4/pkg/workos_errors"
)

// Identity is who WorkOS says signed in.
type Identity struct {
	UserID    string
	Email     string
	FirstName string
	LastName  string
	// SessionID is WorkOS's own session, ended by the logout URL.
	SessionID string
}

// Screen is AuthKit's first screen.
type Screen string

const (
	ScreenSignIn Screen = "sign-in"
	ScreenSignUp Screen = "sign-up"
)

// IdentityProvider is the part of WorkOS sign-in this package uses.
// WorkOS implements it; a test can supply its own.
type IdentityProvider interface {
	AuthorizationURL(state string, screen Screen) (string, error)
	Authenticate(ctx context.Context, code, ip, userAgent string) (Identity, error)
	LogoutURL(sessionID, returnTo string) (string, error)
}

// WorkOS is AuthKit through the WorkOS Go SDK.
type WorkOS struct {
	client      *usermanagement.Client
	clientID    string
	redirectURI string
}

// NewWorkOS builds the provider. Nothing is dialled until a sign-in.
func NewWorkOS(apiKey, clientID, redirectURI string) *WorkOS {
	return &WorkOS{client: usermanagement.NewClient(apiKey), clientID: clientID, redirectURI: redirectURI}
}

// authKitProvider is the provider value that selects AuthKit's hosted
// pages.
const authKitProvider = "authkit"

// AuthorizationURL is where the browser goes to sign in.
func (w *WorkOS) AuthorizationURL(state string, screen Screen) (string, error) {
	u, err := w.client.GetAuthorizationURL(usermanagement.GetAuthorizationURLOpts{
		ClientID: w.clientID, RedirectURI: w.redirectURI, Provider: authKitProvider,
		State: state, ScreenHint: usermanagement.ScreenHint(screen),
	})
	if err != nil {
		return "", fmt.Errorf("auth: workos authorization url: %w", err)
	}
	return u.String(), nil
}

// Authenticate exchanges the callback's code for the user.
func (w *WorkOS) Authenticate(ctx context.Context, code, ip, userAgent string) (Identity, error) {
	res, err := w.client.AuthenticateWithCode(ctx, usermanagement.AuthenticateWithCodeOpts{
		ClientID: w.clientID, Code: code, IPAddress: ip, UserAgent: userAgent,
	})
	if err != nil {
		return Identity{}, fmt.Errorf("auth: workos authenticate: %w", err)
	}
	sid, err := sessionIDFromAccessToken(res.AccessToken)
	if err != nil {
		return Identity{}, err
	}
	return Identity{
		UserID: res.User.ID, Email: res.User.Email,
		FirstName: res.User.FirstName, LastName: res.User.LastName, SessionID: sid,
	}, nil
}

// LogoutURL ends the WorkOS session and returns the browser to returnTo.
func (w *WorkOS) LogoutURL(sessionID, returnTo string) (string, error) {
	u, err := w.client.GetLogoutURL(usermanagement.GetLogoutURLOpts{SessionID: sessionID, ReturnTo: returnTo})
	if err != nil {
		return "", fmt.Errorf("auth: workos logout url: %w", err)
	}
	return u.String(), nil
}

// DeleteUser deletes the member's WorkOS user, which ends every WorkOS
// session it holds. A user WorkOS no longer has is already deleted, so
// its 404 is success: a retry after a lost answer is not a failure.
func (w *WorkOS) DeleteUser(ctx context.Context, userID string) error {
	err := w.client.DeleteUser(ctx, usermanagement.DeleteUserOpts{User: userID})
	var httpErr workos_errors.HTTPError
	if errors.As(err, &httpErr) && httpErr.Code == http.StatusNotFound {
		return nil
	}
	if err != nil {
		return fmt.Errorf("auth: workos delete user: %w", err)
	}
	return nil
}

// sessionIDFromAccessToken reads the sid claim. The token came straight
// from WorkOS over TLS in answer to our own authenticated request, so
// its claims are read, not re-verified: nothing here grants access on
// the strength of the token, which is discarded after this read.
func sessionIDFromAccessToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("auth: workos access token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("auth: workos access token payload: %w", err)
	}
	var claims struct {
		SID string `json:"sid"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("auth: workos access token claims: %w", err)
	}
	return claims.SID, nil
}
