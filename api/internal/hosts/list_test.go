package hosts

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
)

// listOnlyStore answers List with one connection and counts who asked.
type listOnlyStore struct{ asked []uuid.UUID }

func (s *listOnlyStore) List(_ context.Context, accountID uuid.UUID) ([]Connection, error) {
	s.asked = append(s.asked, accountID)
	return []Connection{{Host: "yahoo", Status: StatusConnected, CreatedAt: time.Now()}}, nil
}

func listHosts(t *testing.T, l *List, account *auth.Account) apitypes.HostConnections {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/hosts", nil)
	if account != nil {
		r = r.WithContext(auth.WithAccount(r.Context(), *account))
	}
	w := httptest.NewRecorder()
	l.list(w, r)
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
// reading any account's rows: a switch is not account data. Every open
// host is listed, in order.
func TestHostsAnswersTheSwitchesSignedOut(t *testing.T) {
	store := &listOnlyStore{}
	open := []apitypes.ConnectedHost{apitypes.ConnectedHostFfpc, apitypes.ConnectedHostYahoo}
	l := &List{Enabled: open, Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	out := listHosts(t, l, nil)
	if len(out.Enabled) != 2 || out.Enabled[1] != apitypes.ConnectedHostYahoo || len(out.Connections) != 0 {
		t.Fatalf("signed out: %+v, want both hosts enabled and no connections", out)
	}
	if len(store.asked) != 0 {
		t.Fatalf("signed out read %d accounts' connections", len(store.asked))
	}

	me := auth.Account{ID: uuid.New()}
	out = listHosts(t, l, &me)
	if len(out.Connections) != 1 || out.Connections[0].Host != apitypes.ConnectedHostYahoo || len(store.asked) != 1 || store.asked[0] != me.ID {
		t.Fatalf("signed in: %+v after %v, want the account's one connection", out, store.asked)
	}

	l.Enabled = nil
	if out := listHosts(t, l, nil); len(out.Enabled) != 0 {
		t.Fatalf("every host off, signed out: %+v, want nothing enabled", out)
	}
}
