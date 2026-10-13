package ffpc

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

// listOnlyStore answers List with one connection and counts who asked.
type listOnlyStore struct {
	ConnectionStore
	asked []uuid.UUID
}

func (s *listOnlyStore) List(_ context.Context, accountID uuid.UUID) ([]hosts.Connection, error) {
	s.asked = append(s.asked, accountID)
	return []hosts.Connection{{Host: Host, Status: "connected", CreatedAt: time.Now()}}, nil
}

func listHosts(t *testing.T, s *Service, account *auth.Account) apitypes.HostConnections {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/hosts", nil)
	if account != nil {
		r = r.WithContext(auth.WithAccount(r.Context(), *account))
	}
	w := httptest.NewRecorder()
	s.list(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /hosts answered %d", w.Code)
	}
	var body struct {
		Data apitypes.HostConnections `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Data
}

// Signed out, /hosts answers the switches and no connection, without
// reading any account's rows: a switch is not account data.
func TestHostsAnswersTheSwitchesSignedOut(t *testing.T) {
	store := &listOnlyStore{}
	s := &Service{Enabled: true, Store: store, Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	out := listHosts(t, s, nil)
	if len(out.Enabled) != 1 || out.Enabled[0] != apitypes.ConnectedHostFfpc || len(out.Connections) != 0 {
		t.Fatalf("signed out: %+v, want FFPC enabled and no connections", out)
	}
	if len(store.asked) != 0 {
		t.Fatalf("signed out read %d accounts' connections", len(store.asked))
	}

	me := auth.Account{ID: uuid.New()}
	out = listHosts(t, s, &me)
	if len(out.Connections) != 1 || len(store.asked) != 1 || store.asked[0] != me.ID {
		t.Fatalf("signed in: %+v after %v, want the account's one connection", out, store.asked)
	}

	s.Enabled = false
	if out := listHosts(t, s, nil); len(out.Enabled) != 0 {
		t.Fatalf("switched off, signed out: %+v, want nothing enabled", out)
	}
}
