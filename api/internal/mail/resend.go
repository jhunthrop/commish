// Package mail sends transactional mail through Resend's HTTP API. The
// renewal reminder is its one sender today.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	resendEndpoint = "https://api.resend.com/emails"
	sendTimeout    = 10 * time.Second
	// maxErrorBody is how much of a failed answer is kept for the log.
	maxErrorBody = 1 << 10
)

// Resend sends through Resend.
type Resend struct {
	apiKey string
	from   string
	client *http.Client
}

// NewResend builds a sender. from is the From header.
func NewResend(apiKey, from string) *Resend {
	return &Resend{apiKey: apiKey, from: from, client: &http.Client{Timeout: sendTimeout}}
}

// Send mails one plain-text message.
func (m *Resend) Send(ctx context.Context, to, subject, text string) error {
	body, err := json.Marshal(map[string]any{"from": m.from, "to": []string{to}, "subject": subject, "text": text})
	if err != nil {
		return fmt.Errorf("mail: encode: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("mail: request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("mail: send: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, maxErrorBody))
		return fmt.Errorf("mail: send: status %d: %s", res.StatusCode, detail)
	}
	return nil
}
