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

// openTo opens MyFantasyLeague to one account alone, as its switch's proof
// list does while the switch is off.
type openTo struct{ id uuid.UUID }

func (o openTo) OpenTo(_ context.Context, accountID uuid.UUID) ([]apitypes.ConnectedHost, error) {
	if accountID == o.id {
		return []apitypes.ConnectedHost{apitypes.ConnectedHostMfl}, nil
	}
	return nil, nil
}

type openToFails struct{}

func (openToFails) OpenTo(context.Context, uuid.UUID) ([]apitypes.ConnectedHost, error) {
	return nil, context.DeadlineExceeded
}

// A failed check of the hosts open to one account leaves those out and
// answers the rest: one platform never takes the whole list down.
func TestHostsOpenToFailsAlone(t *testing.T) {
	me := auth.Account{ID: uuid.New()}
	l := &List{Enabled: []apitypes.ConnectedHost{apitypes.ConnectedHostEspn}, Accounts: openToFails{}, Store: &listOnlyStore{},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if out := listHosts(t, l, &me); len(out.Enabled) != 1 || len(out.Connections) != 1 {
		t.Fatalf("%+v", out)
	}
}

// A host open to one account alone is listed to that account signed in,
// never signed out, never to another.
func TestHostsOpenToOneAccount(t *testing.T) {
	me, other := auth.Account{ID: uuid.New()}, auth.Account{ID: uuid.New()}
	l := &List{Enabled: []apitypes.ConnectedHost{apitypes.ConnectedHostEspn}, Accounts: openTo{me.ID}, Store: &listOnlyStore{},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if out := listHosts(t, l, &me); len(out.Enabled) != 2 || out.Enabled[1] != apitypes.ConnectedHostMfl {
		t.Fatalf("the listed account: %+v", out.Enabled)
	}
	for name, acct := range map[string]*auth.Account{"signed out": nil, "another": &other} {
		if out := listHosts(t, l, acct); len(out.Enabled) != 1 {
			t.Fatalf("%s: %+v", name, out.Enabled)
		}
	}
}
