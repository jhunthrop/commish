package notify

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// APNs with a token key (.p8), HTTP/2 to Apple
// (https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).
const (
	APNsProduction = "https://api.push.apple.com"
	APNsSandbox    = "https://api.sandbox.push.apple.com"
	// apnsTokenLife is how long one provider token is reused: Apple refuses
	// one older than an hour and one refreshed more than every twenty
	// minutes.
	apnsTokenLife = 50 * time.Minute
	// apnsUnregistered is the reason (with 410) of a token the app no
	// longer holds. BadDeviceToken is not one: Apple answers it for a token
	// of the other environment (a sandbox build against production), which
	// a wrong APNS_SANDBOX would turn into every registration removed
	// (review M2), so it is a refused message and the token stays.
	apnsUnregistered = "Unregistered"
)

// APNsConfig is the token key and where it sends: APNS_KEY_ID,
// APNS_TEAM_ID and APNS_KEY (the .p8's PEM, from Secret Manager), the
// app's bundle id as the topic, and Apple's production or sandbox origin.
type APNsConfig struct {
	KeyID  string
	TeamID string
	Key    string
	Topic  string
	Origin string
}

// Configured reports whether the key is all here.
func (c APNsConfig) Configured() bool {
	return c.KeyID != "" && c.TeamID != "" && c.Key != "" && c.Topic != ""
}

// ProviderTokens keeps the signed provider token between runs, so one
// token serves every minute's run for its life (review M7). *Store
// implements it.
type ProviderTokens interface {
	ProviderToken(ctx context.Context, keyID string) (token string, issuedAt time.Time, found bool, err error)
	PutProviderToken(ctx context.Context, keyID, token string, issuedAt time.Time) error
}

// APNs sends to Apple's push service with a token key.
type APNs struct {
	cfg    APNsConfig
	key    *ecdsa.PrivateKey
	client *http.Client
	kept   ProviderTokens
	now    func() time.Time

	mu      sync.Mutex
	token   string
	tokenAt time.Time
}

// NewAPNs is APNs for the key, or the not-configured sender until the key
// is all here. A key that is here and does not read is an error: a
// deploy with a broken secret fails loudly, never silently drops iOS.
// kept shares the provider token across runs.
func NewAPNs(cfg APNsConfig, client *http.Client, kept ProviderTokens, now func() time.Time) (Sender, error) {
	if !cfg.Configured() {
		return NotConfigured{Platform: PlatformAPNS}, nil
	}
	key, err := parseP8(cfg.Key)
	if err != nil {
		return nil, err
	}
	if cfg.Origin == "" {
		cfg.Origin = APNsProduction
	}
	if client == nil {
		client = &http.Client{}
	}
	if kept == nil {
		return nil, errors.New("notify: apns needs a store for its provider token")
	}
	return &APNs{cfg: cfg, key: key, client: client, kept: kept, now: now}, nil
}

// parseP8 reads Apple's .p8: a PKCS #8 P-256 key in PEM.
func parseP8(raw string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("notify: APNS_KEY is not a PEM key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("notify: APNS_KEY: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("notify: APNS_KEY is not an ECDSA key")
	}
	return key, nil
}

// providerToken is the ES256 JWT Apple authenticates the key by: this
// process's while it is under apnsTokenLife, else the one an earlier run
// kept in the store, else a fresh one signed and kept.
func (a *APNs) providerToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	if a.token != "" && now.Sub(a.tokenAt) < apnsTokenLife {
		return a.token, nil
	}
	token, at, found, err := a.kept.ProviderToken(ctx, a.cfg.KeyID)
	if err != nil {
		return "", err
	}
	if found && now.Sub(at) < apnsTokenLife && !at.After(now) {
		a.token, a.tokenAt = token, at
		return token, nil
	}
	if token, err = a.sign(now); err != nil {
		return "", err
	}
	if err := a.kept.PutProviderToken(ctx, a.cfg.KeyID, token, now); err != nil {
		return "", err
	}
	a.token, a.tokenAt = token, now
	return token, nil
}

// sign makes a provider token issued at now.
func (a *APNs) sign(now time.Time) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": a.cfg.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": a.cfg.TeamID, "iat": now.Unix()})
	enc := base64.RawURLEncoding
	signing := enc.EncodeToString(header) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, a.key, digest[:])
	if err != nil {
		return "", fmt.Errorf("notify: sign apns token: %w", err)
	}
	return signing + "." + enc.EncodeToString(append(fixed32(r), fixed32(s)...)), nil
}

// fixed32 is a P-256 scalar as JWS's 32 big-endian bytes.
func fixed32(n *big.Int) []byte {
	out := make([]byte, 32)
	return n.FillBytes(out)
}

type apnsAlert struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type apnsAps struct {
	Alert apnsAlert `json:"alert"`
	Sound string    `json:"sound"`
}

// Send posts one alert. 410 or Unregistered is a dead token; another 400
// (BadDeviceToken among them) a message Apple refuses; 403 (the key), 429
// and 5xx are worth a retry. The device token is in the URL's path, so a
// failure's text never carries the URL (post).
func (a *APNs) Send(ctx context.Context, m Message) error {
	body := map[string]any{"aps": apnsAps{Alert: apnsAlert{Title: m.Title, Body: m.Body}, Sound: "default"}}
	for k, v := range payload(m) {
		body[k] = v
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	token, err := a.providerToken(ctx)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.Origin+"/3/device/"+url.PathEscape(m.Token), bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "bearer "+token)
	req.Header.Set("apns-topic", a.cfg.Topic)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	req.Header.Set("content-type", "application/json")
	status, refusal, err := post(ctx, a.client, req)
	if err != nil {
		return fmt.Errorf("notify: apns: %w", err)
	}
	return apnsOutcome(status, refusal)
}

// apnsOutcome reads Apple's answer.
func apnsOutcome(status int, body []byte) error {
	if status == http.StatusOK {
		return nil
	}
	var e struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(body, &e)
	switch {
	case status == http.StatusGone, e.Reason == apnsUnregistered:
		return fmt.Errorf("%w: apns %d %s", ErrDeadToken, status, e.Reason)
	case status == http.StatusBadRequest:
		return fmt.Errorf("%w: apns %d %s", ErrRejected, status, e.Reason)
	}
	return fmt.Errorf("notify: apns answered %d %s", status, e.Reason)
}
