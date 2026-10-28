package auth_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/names"
)

// echoViewer answers the account as it stands.
type echoViewer struct{}

func (echoViewer) View(_ context.Context, a auth.Account) (apitypes.Account, error) {
	return apitypes.Account{Id: a.ID, Handle: a.Handle}, nil
}

// handleStore records the handles set.
type handleStore struct {
	memAccounts
	set []string
}

func (s *handleStore) SetHandle(_ context.Context, id uuid.UUID, handle string) (auth.Account, error) {
	s.set = append(s.set, handle)
	return auth.Account{ID: id, Handle: &handle}, nil
}

// pushSettings refuses a quiet_start of "bad" and records each update.
type pushSettings struct{ updates []apitypes.NotificationSettingsUpdate }

func (p *pushSettings) CheckNotifications(u apitypes.NotificationSettingsUpdate) map[string]string {
	if u.QuietStart != nil && *u.QuietStart == "bad" {
		return map[string]string{"notifications.quiet_start": "Send a time as HH:MM"}
	}
	return nil
}

func (p *pushSettings) UpdateNotifications(_ context.Context, _ uuid.UUID, u apitypes.NotificationSettingsUpdate) error {
	p.updates = append(p.updates, u)
	return nil
}

// PATCH /me carries a handle, push settings, or both; one that sends
// neither is 400, and a fault in either field writes nothing.
func TestUpdateMeHandleAndNotifications(t *testing.T) {
	filter, err := names.Default()
	if err != nil {
		t.Fatal(err)
	}
	store, push := &handleStore{}, &pushSettings{}
	h := &auth.Handler{Store: store, Viewer: echoViewer{}, Names: filter, Notifications: push,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	var patch http.HandlerFunc
	for _, rt := range h.Routes() {
		if rt.Method == http.MethodPatch && rt.Path == "/me" {
			patch = rt.Handler
		}
	}
	acct := auth.Account{ID: uuid.New()}
	call := func(body string) int {
		r := httptest.NewRequest(http.MethodPatch, "/me", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r = r.WithContext(auth.WithAccount(r.Context(), acct))
		w := httptest.NewRecorder()
		patch(w, r)
		return w.Code
	}

	if status := call(`{}`); status != http.StatusBadRequest {
		t.Fatalf("nothing to change: %d", status)
	}
	if status := call(`{"handle": "Gridiron_Gus", "notifications": {"quiet_start": "bad"}}`); status != http.StatusBadRequest {
		t.Fatalf("a bad quiet start: %d", status)
	}
	if status := call(`{"handle": "1nvalid", "notifications": {"quiet_start": "22:00"}}`); status != http.StatusBadRequest {
		t.Fatalf("a bad handle: %d", status)
	}
	if len(store.set) != 0 || len(push.updates) != 0 {
		t.Fatalf("a refused update wrote: %v %v", store.set, push.updates)
	}

	if status := call(`{"notifications": {"kinds": {"starter_status": false}}}`); status != http.StatusOK {
		t.Fatalf("notifications alone: %d", status)
	}
	if len(store.set) != 0 || len(push.updates) != 1 || *push.updates[0].Kinds.StarterStatus {
		t.Fatalf("wrote %v %+v", store.set, push.updates)
	}
	if status := call(`{"handle": "Gridiron_Gus"}`); status != http.StatusOK {
		t.Fatalf("a handle alone: %d", status)
	}
	if len(store.set) != 1 || store.set[0] != "Gridiron_Gus" || len(push.updates) != 1 {
		t.Fatalf("wrote %v %+v", store.set, push.updates)
	}
}
