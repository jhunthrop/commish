package notify

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Platform is who delivers to a device: the devices table's push_platform.
type Platform string

// The platforms, the wire's PushPlatform.
const (
	PlatformAPNS Platform = "apns"
	PlatformFCM  Platform = "fcm"
)

// ParsePlatform reads one of the two words exactly.
func ParsePlatform(raw string) (Platform, bool) {
	switch p := Platform(raw); p {
	case PlatformAPNS, PlatformFCM:
		return p, true
	}
	return "", false
}

// Message is one push to one device.
type Message struct {
	Token string
	Kind  Kind
	Title string
	Body  string
	Data  map[string]string
}

// Sender delivers a message to one device. A send answers nil, or an
// error that errors.Is one of the outcomes below; anything else is a
// failure worth a retry (the network, the platform's 5xx or 429).
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// The outcomes a sender names.
var (
	// ErrDeadToken is a token the platform no longer delivers to (FCM
	// UNREGISTERED, APNs 410 or Unregistered): the registration goes.
	ErrDeadToken = errors.New("notify: the platform says the token is dead")
	// ErrNotConfigured is a platform whose sender has no credentials here
	// (APNs until its key is in Secret Manager): nothing is tried.
	ErrNotConfigured = errors.New("notify: the platform's sender is not configured")
	// ErrRejected is a message the platform refused for itself (a 400 that
	// is not the token): sending it again would be refused again.
	ErrRejected = errors.New("notify: the platform refused the message")
)

// sendTimeout bounds one platform request.
const sendTimeout = 10 * time.Second

// maxErrorBody bounds how much of a refusal is read.
const maxErrorBody = 16 << 10

// NotConfigured is the sender of a platform with no credentials here.
type NotConfigured struct{ Platform Platform }

// Send answers ErrNotConfigured and tries nothing.
func (n NotConfigured) Send(context.Context, Message) error {
	return fmt.Errorf("%w: %s", ErrNotConfigured, n.Platform)
}

// post sends one JSON request and answers the status and up to
// maxErrorBody of a body that is not a 200's. A transport failure is
// answered without its URL: APNs carries the device token in the path,
// and a send's error is logged (security review M2).
func post(ctx context.Context, client *http.Client, req *http.Request) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return 0, nil, withoutURL(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, maxErrorBody))
		return res.StatusCode, nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxErrorBody))
	return res.StatusCode, body, err
}

// withoutURL is a request's error with the URL taken out: its operation
// and the underlying error only.
func withoutURL(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return fmt.Errorf("%s request: %w", ue.Op, ue.Err)
	}
	return err
}

// payload is the data a device receives: the row's data without the
// outbox's own fields (the dedupe key, the topic and its time), and the
// kind.
func payload(m Message) map[string]string {
	out := make(map[string]string, len(m.Data)+1)
	for k, v := range m.Data {
		if k != DedupeKey && k != TopicKey && k != TopicAtKey {
			out[k] = v
		}
	}
	out["kind"] = string(m.Kind)
	return out
}
