package notify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"google.golang.org/api/idtoken"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// The internal route's limits: a coarse one by address in front of the
// identity check, and the real one by the verified caller behind it, so
// a stranger sharing the job's egress address cannot spend the job's
// (security review L2).
const (
	limitInternalPerAddress = 60
	limitInternalPerCaller  = 6
)

// StarterStatusPath is the route the hourly capture calls after each pass.
const StarterStatusPath = "/internal/notifications/starter-status"

// maxIdentityHeader bounds the Authorization header read.
const maxIdentityHeader = 4096

// googleIssuers are the issuers of a Google-signed identity token.
var googleIssuers = []string{"https://accounts.google.com", "accounts.google.com"}

// IdentityVerifier checks a caller's identity token and answers its
// verified email.
type IdentityVerifier interface {
	Verify(ctx context.Context, token string) (string, error)
}

// GoogleIdentity verifies Google-signed OIDC identity tokens for one
// audience, the API's own URL: what a Cloud Run job's service account
// mints from its metadata server. RS256 only, a Google issuer only, an
// audience always (security review L1).
type GoogleIdentity struct{ Audience string }

// Verify checks the token's algorithm before anything else (the ES256
// path of the library is never reached by a forged header), then its
// signature, expiry and audience, then its issuer, and answers its email
// when Google verified it.
func (g GoogleIdentity) Verify(ctx context.Context, token string) (string, error) {
	if g.Audience == "" {
		return "", errors.New("notify: no audience to verify identity tokens for")
	}
	if alg, err := tokenAlg(token); err != nil || alg != "RS256" {
		return "", fmt.Errorf("notify: identity token algorithm %q refused: %v", alg, err)
	}
	payload, err := idtoken.Validate(ctx, token, g.Audience)
	if err != nil {
		return "", fmt.Errorf("notify: identity token: %w", err)
	}
	if !slices.Contains(googleIssuers, payload.Issuer) {
		return "", fmt.Errorf("notify: identity token issuer %q refused", payload.Issuer)
	}
	email, _ := payload.Claims["email"].(string)
	verified, _ := payload.Claims["email_verified"].(bool)
	if email == "" || !verified {
		return "", errors.New("notify: identity token carries no verified email")
	}
	return email, nil
}

// tokenAlg is a JWT's header algorithm.
func tokenAlg(token string) (string, error) {
	head, _, ok := strings.Cut(token, ".")
	if !ok {
		return "", errors.New("not a JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(head)
	if err != nil {
		return "", err
	}
	var h struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		return "", err
	}
	return h.Alg, nil
}

// Requests records that a producer was asked to run. *Store implements
// it.
type Requests interface {
	RequestRun(ctx context.Context, producer string, at time.Time) error
}

// Internal serves the routes our own jobs call: a verified identity on
// Callers, never a member. The starter status route only records the
// request and answers 202; the notify job runs the producer (re-review
// N1), so nothing runs on the API service after the answer.
type Internal struct {
	Verifier IdentityVerifier
	// Callers are the service accounts allowed (INTERNAL_CALLERS); none
	// refuses every call.
	Callers  []string
	Requests Requests
	Now      func() time.Time
	Log      *slog.Logger
}

type callerKey struct{}

// Routes is every internal route. Webhook access: no session, no CSRF;
// the handler checks the identity itself.
func (h *Internal) Routes() []httpx.Route {
	perCaller := httpx.RateLimit(httpx.NewLimiter(httpx.PerMinute(limitInternalPerCaller), h.Now), func(r *http.Request) string {
		email, _ := r.Context().Value(callerKey{}).(string)
		return "internal:" + email
	})(http.HandlerFunc(h.starterStatus))
	return []httpx.Route{
		{Method: http.MethodPost, Path: StarterStatusPath, Access: httpx.Webhook,
			Limit: httpx.PerMinute(limitInternalPerAddress), Handler: h.verified(perCaller)},
	}
}

// verified answers 401 unless the caller's identity verifies and is on
// Callers, and hands the next handler the caller's email.
func (h *Internal) verified(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(raw, "Bearer ")
		if !ok || token == "" || len(raw) > maxIdentityHeader || h.Verifier == nil || len(h.Callers) == 0 {
			unauthorized(w, r)
			return
		}
		email, err := h.Verifier.Verify(r.Context(), token)
		if err != nil || !slices.Contains(h.Callers, email) {
			h.Log.Warn("notify: internal call refused", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
			unauthorized(w, r)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, email)))
	}
}

func unauthorized(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "An internal caller's identity is required", nil)
}

func (h *Internal) starterStatus(w http.ResponseWriter, r *http.Request) {
	at := h.Now()
	if err := h.Requests.RequestRun(r.Context(), markStarterStatus, at); err != nil {
		httpx.WriteInternal(w, r, h.Log, "notify: request starter status", err)
		return
	}
	email, _ := r.Context().Value(callerKey{}).(string)
	h.Log.Info("notify: starter status requested", "caller", email)
	httpx.WriteOK(w, r, http.StatusAccepted, apitypes.StarterStatusAccepted{RequestedAt: at})
}
