package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"google.golang.org/api/option"
	htransport "google.golang.org/api/transport/http"
)

// FCM v1 (https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send).
const (
	fcmEndpoint = "https://fcm.googleapis.com"
	fcmScope    = "https://www.googleapis.com/auth/firebase.messaging"
	// fcmUnregistered is the FcmError code of a token the app no longer
	// holds: the one dead-token answer.
	fcmUnregistered = "UNREGISTERED"
)

// FCM sends through Firebase Cloud Messaging's HTTP v1 API. Client
// carries the credentials: the runtime's own identity in production.
type FCM struct {
	ProjectID string
	Client    *http.Client
	// Endpoint is FCM's origin, fcmEndpoint unless a test points it away.
	Endpoint string
}

// NewFCM is FCM for the project with the process's default credentials
// (on Cloud Run, the service account's own identity; no key file), or
// the not-configured sender when no project is named.
func NewFCM(ctx context.Context, projectID string) (Sender, error) {
	if projectID == "" {
		return NotConfigured{Platform: PlatformFCM}, nil
	}
	client, _, err := htransport.NewClient(ctx, option.WithScopes(fcmScope))
	if err != nil {
		return nil, fmt.Errorf("notify: fcm credentials: %w", err)
	}
	return &FCM{ProjectID: projectID, Client: client, Endpoint: fcmEndpoint}, nil
}

type fcmRequest struct {
	Message fcmMessage `json:"message"`
}

type fcmMessage struct {
	Token        string            `json:"token"`
	Notification fcmNotification   `json:"notification"`
	Data         map[string]string `json:"data"`
	Android      fcmAndroid        `json:"android"`
}

type fcmNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type fcmAndroid struct {
	Priority string `json:"priority"`
}

type fcmError struct {
	Error struct {
		Code    int    `json:"code"`
		Status  string `json:"status"`
		Details []struct {
			ErrorCode string `json:"errorCode"`
		} `json:"details"`
	} `json:"error"`
}

// Send posts one message. Only an UNREGISTERED detail is a dead token: a
// bare 404 is also FCM's answer to a wrong project id or path, and must
// never remove registrations (review H1), so it is retried like 401, 403,
// 429 and 5xx; another 400 is a message FCM refuses.
func (f *FCM) Send(ctx context.Context, m Message) error {
	body, err := json.Marshal(fcmRequest{Message: fcmMessage{
		Token: m.Token, Notification: fcmNotification{Title: m.Title, Body: m.Body},
		Data: payload(m), Android: fcmAndroid{Priority: "high"},
	}})
	if err != nil {
		return err
	}
	endpoint := f.Endpoint + "/v1/projects/" + url.PathEscape(f.ProjectID) + "/messages:send"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	status, refusal, err := post(ctx, f.Client, req)
	if err != nil {
		return fmt.Errorf("notify: fcm: %w", err)
	}
	return fcmOutcome(status, refusal)
}

// fcmOutcome reads FCM's answer.
func fcmOutcome(status int, body []byte) error {
	if status == http.StatusOK {
		return nil
	}
	var e fcmError
	_ = json.Unmarshal(body, &e)
	for _, d := range e.Error.Details {
		if d.ErrorCode == fcmUnregistered {
			return fmt.Errorf("%w: fcm %d %s", ErrDeadToken, status, d.ErrorCode)
		}
	}
	if status == http.StatusBadRequest {
		return fmt.Errorf("%w: fcm %d %s", ErrRejected, status, e.Error.Status)
	}
	return fmt.Errorf("notify: fcm answered %d %s", status, e.Error.Status)
}
