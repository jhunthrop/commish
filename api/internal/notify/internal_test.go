package notify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

const researchCaller = "research-runtime@trycommish.iam.gserviceaccount.com"

// fakeVerifier answers the email for the one good token.
type fakeVerifier map[string]string

func (f fakeVerifier) Verify(_ context.Context, token string) (string, error) {
	if email, ok := f[token]; ok {
		return email, nil
	}
	return "", errors.New("bad token")
}

// memoryRequests records every request.
type memoryRequests struct {
	mu        sync.Mutex
	requested []time.Time
}

func (m *memoryRequests) RequestRun(_ context.Context, _ string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requested = append(m.requested, at)
	return nil
}

func (m *memoryRequests) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.requested)
}

func internalRoute(requests Requests, callers []string, now time.Time) http.HandlerFunc {
	h := &Internal{Verifier: fakeVerifier{"good": researchCaller, "stranger": "someone@example.iam.gserviceaccount.com"},
		Callers: callers, Requests: requests, Now: func() time.Time { return now }, Log: quiet()}
	return h.Routes()[0].Handler
}

func callRoute(h http.HandlerFunc, auth, addr string) (int, []byte) {
	r := httptest.NewRequest(http.MethodPost, StarterStatusPath, nil)
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	if addr != "" {
		r.RemoteAddr = addr
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w.Code, w.Body.Bytes()
}

// The internal route opens only for a verified caller on the list: no
// token, a bad one, a good one from another service account, and no list
// at all are each 401 and record nothing. The research runtime's call
// records the request and is answered 202; nothing more runs here (the
// notify job does the work, re-review N1).
func TestInternalRouteNeedsTheCallersIdentity(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	requests := &memoryRequests{}
	handler := internalRoute(requests, []string{researchCaller}, now)
	for _, auth := range []string{"", "Bearer ", "Bearer bad", "Bearer stranger", "Basic good"} {
		if status, _ := callRoute(handler, auth, ""); status != http.StatusUnauthorized {
			t.Fatalf("%q: %d", auth, status)
		}
	}
	if status, _ := callRoute(internalRoute(requests, nil, now), "Bearer good", ""); status != http.StatusUnauthorized {
		t.Fatalf("no callers listed: %d", status)
	}
	if requests.count() != 0 {
		t.Fatalf("a refused call recorded %d requests", requests.count())
	}
	status, body := callRoute(handler, "Bearer good", "")
	var env struct {
		Data struct {
			RequestedAt time.Time `json:"requested_at"`
		} `json:"data"`
	}
	if status != http.StatusAccepted || json.Unmarshal(body, &env) != nil || !env.Data.RequestedAt.Equal(now) || requests.count() != 1 {
		t.Fatalf("%d %s, %d requests", status, body, requests.count())
	}
}

// The caller's own bucket: six calls a minute from the verified caller,
// whatever address they come from (security review L2).
func TestInternalRouteLimitsByCaller(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	handler := internalRoute(&memoryRequests{}, []string{researchCaller}, now)
	codes := map[int]int{}
	for i := range limitInternalPerCaller + 1 {
		status, _ := callRoute(handler, "Bearer good", "203.0.113."+string(rune('1'+i))+":443")
		codes[status]++
	}
	if codes[http.StatusAccepted] != limitInternalPerCaller || codes[http.StatusTooManyRequests] != 1 {
		t.Fatalf("answers %v", codes)
	}
}

// Google identity tokens: RS256 only, decided before any key is fetched,
// and never without an audience (security review L1).
func TestGoogleIdentityRefusesBeforeFetching(t *testing.T) {
	jwt := func(header string) string {
		return base64.RawURLEncoding.EncodeToString([]byte(header)) + ".e30.sig"
	}
	g := GoogleIdentity{Audience: "https://api.example.invalid"}
	for _, token := range []string{jwt(`{"alg":"ES256","kid":"iap"}`), jwt(`{"alg":"none"}`), "not-a-jwt", jwt(`not json`)} {
		if _, err := g.Verify(context.Background(), token); err == nil {
			t.Fatalf("%q verified", token)
		}
	}
	if alg, err := tokenAlg(jwt(`{"alg":"RS256","kid":"k"}`)); err != nil || alg != "RS256" {
		t.Fatalf("alg %q %v", alg, err)
	}
	if _, err := (GoogleIdentity{}).Verify(context.Background(), jwt(`{"alg":"RS256"}`)); err == nil {
		t.Fatal("verified with no audience")
	}
}
