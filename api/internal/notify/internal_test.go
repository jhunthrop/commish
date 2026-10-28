package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
type recordingQueue struct{ runs int }

func (q *recordingQueue) PushAccounts(context.Context, Kind) ([]uuid.UUID, error) {
	q.runs++
	return nil, nil
}

func (q *recordingQueue) Preferences(context.Context, uuid.UUID) (Preferences, error) {
	return DefaultPreferences(), nil
}

func (q *recordingQueue) Enqueue(context.Context, []Notification) (int, error) { return 0, nil }

// The internal route opens only for a verified caller on the list: no
// token, a bad one, a good one from another service account, and no list
// at all are each 401, and the producer never runs; the research
// runtime's runs it and is answered the count.
func TestInternalRouteNeedsTheCallersIdentity(t *testing.T) {
	queue := &recordingQueue{}
	pair := fixturePair()
	now := pair.NewerAt.Add(time.Minute)
	producer := &StarterStatus{Designations: fakeDesignations{pair: pair}, Lineups: fakeLineups{}, Queue: queue,
		Now: func() time.Time { return now }, Log: quiet()}
	verifier := fakeVerifier{"good": researchCaller, "stranger": "someone@example.iam.gserviceaccount.com"}
	h := &Internal{Verifier: verifier, Callers: []string{researchCaller}, StarterStatus: producer, Log: quiet()}
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
	closed := &Internal{Verifier: verifier, StarterStatus: producer, Log: quiet()}
	if status, _ := call(closed.Routes()[0].Handler, "Bearer good"); status != http.StatusUnauthorized {
		t.Fatalf("no callers listed: %d", status)
	}
	if queue.runs != 0 {
		t.Fatalf("the producer ran %d times for a refused call", queue.runs)
	}

	status, body := call(handler, "Bearer good")
	var env struct {
		Data apitypes.StarterStatusProduced `json:"data"`
	}
	if status != http.StatusOK || json.Unmarshal(body, &env) != nil || env.Data.Changes != 6 || queue.runs != 1 {
		t.Fatalf("%d %s (runs %d)", status, body, queue.runs)
	}
}
