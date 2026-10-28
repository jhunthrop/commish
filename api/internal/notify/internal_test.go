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

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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

// recordingQueue is a queue with no accounts, counting the runs that
// reached it.
type recordingQueue struct {
	mu   sync.Mutex
	runs int
}

func (q *recordingQueue) PushAccounts(context.Context, Kind, time.Time) ([]uuid.UUID, bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.runs++
	return nil, false, nil
}

func (q *recordingQueue) count() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.runs
}

func (q *recordingQueue) Preferences(context.Context, uuid.UUID) (Preferences, error) {
	return DefaultPreferences(), nil
}

func (q *recordingQueue) Enqueue(context.Context, []Notification) (int, error) { return 0, nil }

// memoryMarks is the marks in memory: every request recorded, every run
// let through, its newest input kept.
type memoryMarks struct {
	mu        sync.Mutex
	requested []time.Time
	through   time.Time
}

func (m *memoryMarks) RequestRun(_ context.Context, _ string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requested = append(m.requested, at)
	return nil
}

func (m *memoryMarks) RunExclusive(ctx context.Context, _ string, fn func(context.Context) (time.Time, error)) (bool, error) {
	through, err := fn(ctx)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.through = through
	return true, err
}

// The internal route opens only for a verified caller on the list: no
// token, a bad one, a good one from another service account, and no list
// at all are each 401, and the producer never runs. The research
// runtime's call is answered 202 with the request recorded, and the
// producer runs off the request (review M6).
func TestInternalRouteNeedsTheCallersIdentity(t *testing.T) {
	queue := &recordingQueue{}
	pair := fixturePair()
	now := pair.NewerAt.Add(time.Minute)
	clockNow := func() time.Time { return now }
	producer := &StarterStatus{Designations: pairsOf(pair), Lineups: fakeLineups{}, Queue: queue, Now: clockNow, Log: quiet()}
	verifier := fakeVerifier{"good": researchCaller, "stranger": "someone@example.iam.gserviceaccount.com"}
	marks := &memoryMarks{}
	ran := make(chan struct{}, 1)
	h := &Internal{Verifier: verifier, Callers: []string{researchCaller}, StarterStatus: producer, Marks: marks,
		Context: context.Background(), Now: clockNow, Log: quiet(), done: func() { ran <- struct{}{} }}
	handler := h.Routes()[0].Handler
	call := func(h http.HandlerFunc, auth string) (int, []byte) {
		r := httptest.NewRequest(http.MethodPost, StarterStatusPath, nil)
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		w := httptest.NewRecorder()
		h(w, r)
		return w.Code, w.Body.Bytes()
	}
	for _, auth := range []string{"", "Bearer ", "Bearer bad", "Bearer stranger", "Basic good"} {
		if status, _ := call(handler, auth); status != http.StatusUnauthorized {
			t.Fatalf("%q: %d", auth, status)
		}
	}
	closed := &Internal{Verifier: verifier, StarterStatus: producer, Marks: marks, Context: context.Background(), Now: clockNow, Log: quiet()}
	if status, _ := call(closed.Routes()[0].Handler, "Bearer good"); status != http.StatusUnauthorized {
		t.Fatalf("no callers listed: %d", status)
	}
	if queue.count() != 0 || len(marks.requested) != 0 {
		t.Fatalf("a refused call ran the producer %d times", queue.count())
	}

	status, body := call(handler, "Bearer good")
	var env struct {
		Data apitypes.StarterStatusAccepted `json:"data"`
	}
	if status != http.StatusAccepted || json.Unmarshal(body, &env) != nil || !env.Data.RequestedAt.Equal(now) {
		t.Fatalf("%d %s", status, body)
	}
	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("the producer never ran")
	}
	if queue.count() != 1 || len(marks.requested) != 1 || !marks.through.Equal(pair.NewerAt) {
		t.Fatalf("runs %d, requests %v, through %v", queue.count(), marks.requested, marks.through)
	}
}

// The caller's own bucket: six calls a minute from the verified caller,
// whatever address they come from (security review L2).
func TestInternalRouteLimitsByCaller(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	h := &Internal{Verifier: fakeVerifier{"good": researchCaller}, Callers: []string{researchCaller},
		StarterStatus: &StarterStatus{Designations: pairsOf(), Queue: &recordingQueue{}, Now: func() time.Time { return now }, Log: quiet()},
		Marks:         &memoryMarks{}, Context: context.Background(), Now: func() time.Time { return now }, Log: quiet()}
	handler := h.Routes()[0].Handler
	codes := map[int]int{}
	for i := range limitInternalPerCaller + 1 {
		r := httptest.NewRequest(http.MethodPost, StarterStatusPath, nil)
		r.RemoteAddr = "203.0.113." + string(rune('1'+i)) + ":443"
		r.Header.Set("Authorization", "Bearer good")
		w := httptest.NewRecorder()
		handler(w, r)
		codes[w.Code]++
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
