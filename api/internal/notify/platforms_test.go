package notify

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// p8 is a fresh P-256 key as Apple's .p8 holds one.
func p8(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// verifyES256 checks a provider token against the key and answers its
// header and claims.
func verifyES256(t *testing.T, pub *ecdsa.PublicKey, token string) (map[string]any, map[string]any) {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token %q", token)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		t.Fatalf("signature %v %d", err, len(sig))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("the provider token does not verify")
	}
	var header, claims map[string]any
	for i, dst := range []*map[string]any{&header, &claims} {
		raw, _ := base64.RawURLEncoding.DecodeString(parts[i])
		if err := json.Unmarshal(raw, dst); err != nil {
			t.Fatal(err)
		}
	}
	return header, claims
}

// memoryTokens is the provider token store in memory.
type memoryTokens struct {
	mu     sync.Mutex
	token  string
	at     time.Time
	writes int
}

func (m *memoryTokens) ProviderToken(context.Context, string) (string, time.Time, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.token, m.at, m.token != "", nil
}

func (m *memoryTokens) PutProviderToken(_ context.Context, _, token string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.token, m.at = token, at
	m.writes++
	return nil
}

// The APNs provider answers not configured, and tries nothing, until the
// whole key is here; a key that is here and does not read is an error.
func TestAPNsNotConfigured(t *testing.T) {
	for _, cfg := range []APNsConfig{{}, {KeyID: "K", TeamID: "T", Topic: "app.trycommish.ios"}} {
		s, err := NewAPNs(cfg, nil, &memoryTokens{}, time.Now)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Send(context.Background(), Message{Token: iosToken}); !errors.Is(err, ErrNotConfigured) {
			t.Fatalf("%+v: %v", cfg, err)
		}
	}
	if _, err := NewAPNs(APNsConfig{KeyID: "K", TeamID: "T", Key: "not a key", Topic: "app.trycommish.ios"}, nil, &memoryTokens{}, time.Now); err == nil {
		t.Fatal("a broken key was taken")
	}
}

// Configured, APNs posts the alert with a signed provider token, the
// topic and the push type, and reads Apple's answers: 410 and
// Unregistered are dead tokens; BadDeviceToken (a sandbox token on
// production) and another 400 a refused message, the token kept (review
// M2); a 5xx worth a retry.
func TestAPNsSends(t *testing.T) {
	key, pemKey := p8(t)
	answers := map[string]struct {
		status int
		reason string
	}{
		"gone" + iosToken:        {http.StatusGone, "Unregistered"},
		"unreg" + iosToken:       {http.StatusBadRequest, "Unregistered"},
		"bad" + iosToken:         {http.StatusBadRequest, "BadDeviceToken"},
		"refused" + iosToken:     {http.StatusBadRequest, "PayloadTooLarge"},
		"unavailable" + iosToken: {http.StatusServiceUnavailable, "ServiceUnavailable"},
	}
	var got []*http.Request
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r)
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		if a, ok := answers[strings.TrimPrefix(r.URL.Path, "/3/device/")]; ok {
			w.WriteHeader(a.status)
			_, _ = w.Write([]byte(`{"reason":"` + a.reason + `"}`))
		}
	}))
	defer srv.Close()
	now := time.Date(2026, 10, 25, 16, 0, 0, 0, time.UTC)
	s, err := NewAPNs(APNsConfig{KeyID: "KEY123", TeamID: "TEAM45", Key: pemKey, Topic: "app.trycommish.ios", Origin: srv.URL},
		srv.Client(), &memoryTokens{}, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	m := Message{Token: iosToken, Kind: KindStarterStatus, Title: "Ja'Marr Chase is out", Body: "Set a replacement.",
		Data: map[string]string{DedupeKey: "k", "player_id": "p1"}}
	if err := s.Send(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	r := got[0]
	if r.URL.Path != "/3/device/"+iosToken || r.Header.Get("apns-topic") != "app.trycommish.ios" ||
		r.Header.Get("apns-push-type") != "alert" || r.Header.Get("apns-priority") != "10" {
		t.Fatalf("request %s %v", r.URL.Path, r.Header)
	}
	header, claims := verifyES256(t, &key.PublicKey, strings.TrimPrefix(r.Header.Get("authorization"), "bearer "))
	if header["alg"] != "ES256" || header["kid"] != "KEY123" || claims["iss"] != "TEAM45" || claims["iat"] != float64(now.Unix()) {
		t.Fatalf("token %v %v", header, claims)
	}
	aps, _ := bodies[0]["aps"].(map[string]any)
	alert, _ := aps["alert"].(map[string]any)
	if alert["title"] != m.Title || bodies[0]["player_id"] != "p1" || bodies[0]["kind"] != "starter_status" || bodies[0][DedupeKey] != nil {
		t.Fatalf("body %v", bodies[0])
	}

	for prefix, want := range map[string]error{"gone": ErrDeadToken, "unreg": ErrDeadToken, "bad": ErrRejected, "refused": ErrRejected} {
		if err := s.Send(context.Background(), Message{Token: prefix + iosToken}); !errors.Is(err, want) {
			t.Fatalf("%s: %v", prefix, err)
		}
	}
	err = s.Send(context.Background(), Message{Token: "unavailable" + iosToken})
	if err == nil || errors.Is(err, ErrDeadToken) || errors.Is(err, ErrRejected) {
		t.Fatalf("a 503 is worth a retry: %v", err)
	}
}

// FCM posts the v1 message for the project, and reads its answers:
// UNREGISTERED alone is a dead token, a bare 404 (a wrong project id)
// worth a retry like a 429 or 5xx (review H1), another 400 a refused
// message. No project named is not configured.
func TestFCMSends(t *testing.T) {
	var paths []string
	var bodies []fcmRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		var body fcmRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		switch body.Message.Token {
		case "gone":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":404,"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`))
		case "refused":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"errorCode":"INVALID_ARGUMENT"}]}}`))
		case "wrong-project":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":404,"status":"NOT_FOUND"}}`))
		case "busy":
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}`))
		}
	}))
	defer srv.Close()
	f := &FCM{ProjectID: "trycommish", Client: srv.Client(), Endpoint: srv.URL}
	m := Message{Token: androidToken, Kind: KindStarterStatus, Title: "T", Body: "B", Data: map[string]string{DedupeKey: "k", "path": "/league/x/start"}}
	if err := f.Send(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	if paths[0] != "/v1/projects/trycommish/messages:send" {
		t.Fatalf("path %s", paths[0])
	}
	b := bodies[0].Message
	if b.Token != androidToken || b.Notification.Title != "T" || b.Data["path"] != "/league/x/start" || b.Data[DedupeKey] != "" ||
		b.Data["kind"] != "starter_status" || b.Android.Priority != "high" {
		t.Fatalf("message %+v", b)
	}
	for token, want := range map[string]error{"gone": ErrDeadToken, "refused": ErrRejected} {
		if err := f.Send(context.Background(), Message{Token: token}); !errors.Is(err, want) {
			t.Fatalf("%s: %v", token, err)
		}
	}
	for _, token := range []string{"busy", "wrong-project"} {
		if err := f.Send(context.Background(), Message{Token: token}); err == nil || errors.Is(err, ErrDeadToken) || errors.Is(err, ErrRejected) {
			t.Fatalf("%s is worth a retry: %v", token, err)
		}
	}

	none, err := NewFCM(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := none.Send(context.Background(), m); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("no project: %v", err)
	}
}

// A transport failure's error never carries the URL, which holds the
// APNs device token (security review M2).
func TestAPNsFailureKeepsTheTokenOutOfTheError(t *testing.T) {
	_, pemKey := p8(t)
	failing := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("connection reset by peer")
	})}
	s, err := NewAPNs(APNsConfig{KeyID: "K", TeamID: "T", Key: pemKey, Topic: "app.trycommish.ios", Origin: "https://apns.example.invalid"},
		failing, &memoryTokens{}, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	err = s.Send(context.Background(), Message{Token: iosToken})
	if err == nil || strings.Contains(err.Error(), iosToken) || strings.Contains(err.Error(), "/3/device") {
		t.Fatalf("the error carried the URL: %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// The provider token is signed once and reused by every sender built
// within its life, each a new run's (review M7); past its life a new one
// is signed and kept.
func TestAPNsProviderTokenIsSharedAcrossRuns(t *testing.T) {
	_, pemKey := p8(t)
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		auths = append(auths, r.Header.Get("authorization"))
	}))
	defer srv.Close()
	kept := &memoryTokens{}
	at := time.Date(2026, 10, 25, 16, 0, 0, 0, time.UTC)
	run := func() {
		s, err := NewAPNs(APNsConfig{KeyID: "K", TeamID: "T", Key: pemKey, Topic: "app.trycommish.ios", Origin: srv.URL},
			srv.Client(), kept, func() time.Time { return at })
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Send(context.Background(), Message{Token: iosToken}); err != nil {
			t.Fatal(err)
		}
	}
	run()
	at = at.Add(time.Minute)
	run()
	at = at.Add(30 * time.Minute)
	run()
	if kept.writes != 1 || auths[0] != auths[1] || auths[1] != auths[2] {
		t.Fatalf("%d signings within the life", kept.writes)
	}
	at = at.Add(apnsTokenLife)
	run()
	if kept.writes != 2 || auths[3] == auths[2] {
		t.Fatalf("no new token past the life: %d", kept.writes)
	}
}
