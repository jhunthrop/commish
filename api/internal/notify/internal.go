package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"google.golang.org/api/idtoken"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// limitInternalPerMinute bounds the internal routes: the hourly capture
// calls once a pass.
const limitInternalPerMinute = 6

// StarterStatusPath is the route the hourly capture calls after each pass.
const StarterStatusPath = "/internal/notifications/starter-status"

// maxIdentityHeader bounds the Authorization header read.
const maxIdentityHeader = 4096

// IdentityVerifier checks a caller's identity token and answers its
// verified email.
type IdentityVerifier interface {
	Verify(ctx context.Context, token string) (string, error)
}

// GoogleIdentity verifies Google-signed OIDC identity tokens for one
// audience, the API's own URL: what a Cloud Run job's service account
// mints from its metadata server.
type GoogleIdentity struct{ Audience string }

// Verify checks the token's signature, expiry and audience, and answers
// its email when Google verified it.
func (g GoogleIdentity) Verify(ctx context.Context, token string) (string, error) {
	payload, err := idtoken.Validate(ctx, token, g.Audience)
	if err != nil {
		return "", fmt.Errorf("notify: identity token: %w", err)
	}
	email, _ := payload.Claims["email"].(string)
	verified, _ := payload.Claims["email_verified"].(bool)
	if email == "" || !verified {
		return "", errors.New("notify: identity token carries no verified email")
	}
	return email, nil
}

// Internal serves the routes our own jobs call: a verified identity on
// Callers, never a member.
type Internal struct {
	Verifier IdentityVerifier
	// Callers are the service accounts allowed (INTERNAL_CALLERS); none
	// refuses every call.
	Callers       []string
	StarterStatus *StarterStatus
	Log           *slog.Logger
}

// Routes is every internal route. Webhook access: no session, no CSRF;
// the handler checks the identity itself.
func (h *Internal) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: StarterStatusPath, Access: httpx.Webhook,
			Limit: httpx.PerMinute(limitInternalPerMinute), Handler: h.starterStatus},
	}
}

// caller is the verified caller's email, or a 401 answered.
func (h *Internal) caller(w http.ResponseWriter, r *http.Request) (string, bool) {
	raw := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(raw, "Bearer ")
	if !ok || token == "" || len(raw) > maxIdentityHeader || h.Verifier == nil || len(h.Callers) == 0 {
		httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "An internal caller's identity is required", nil)
		return "", false
	}
	email, err := h.Verifier.Verify(r.Context(), token)
	if err != nil || !slices.Contains(h.Callers, email) {
		h.Log.Warn("notify: internal call refused", "request_id", httpx.RequestIDFrom(r.Context()), "email", email, "err", err)
		httpx.WriteError(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "An internal caller's identity is required", nil)
		return "", false
	}
	return email, true
}

func (h *Internal) starterStatus(w http.ResponseWriter, r *http.Request) {
	email, ok := h.caller(w, r)
	if !ok {
		return
	}
	got, err := h.StarterStatus.Produce(r.Context())
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "notify: starter status", err)
		return
	}
	h.Log.Info("notify: starter status produced", "caller", email, "changes", got.Changes, "queued", got.Queued)
	httpx.WriteOK(w, r, http.StatusOK, apitypes.StarterStatusProduced{Changes: got.Changes, Queued: got.Queued, NewerAt: got.NewerAt})
}
