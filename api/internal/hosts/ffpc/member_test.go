package ffpc

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// memoryConnections is hosts.Store in memory, with its lock rule.
type memoryConnections struct {
	conn    hosts.Connection
	renewed int
}

func (m *memoryConnections) Get(_ context.Context, accountID uuid.UUID, _ string) (hosts.Connection, error) {
	if m.conn.AccountID != accountID {
		return hosts.Connection{}, hosts.ErrNotConnected
	}
	return m.conn, nil
}

func (m *memoryConnections) Renewed(_ context.Context, _ uuid.UUID, _ string, sealed hosts.Sealed) error {
	m.conn.Sealed, m.conn.Status, m.conn.FailedSignIns = sealed, hosts.StatusConnected, 0
	m.renewed++
	return nil
}

func (m *memoryConnections) Refused(context.Context, uuid.UUID, string) (string, error) {
	m.conn.FailedSignIns++
	m.conn.Status = hosts.StatusSignedOut
	if m.conn.FailedSignIns >= hosts.MaxFailedSignIns {
		m.conn.Status = hosts.StatusLocked
	}
	return m.conn.Status, nil
}

func (m *memoryConnections) Read(context.Context, uuid.UUID, string, time.Time) error { return nil }

func member(t *testing.T, password string) (*Member, *memoryConnections, uuid.UUID) {
	t.Helper()
	c, _ := testClient(t)
	vault, err := hosts.NewVault(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	account := uuid.New()
	// A session FFPC no longer honors, and the kept sign-in.
	sealed, err := vault.Seal(account.String(), Host, hosts.Secret{Username: testUser, Password: password, Cookies: map[string]string{"BGSLMSession": "old"}})
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryConnections{conn: hosts.Connection{AccountID: account, Host: Host, Status: hosts.StatusConnected, Sealed: sealed}}
	m := &Member{Client: c, Store: store, Vault: vault, Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return m, store, account
}

// A signed-out session is renewed once with the kept sign-in and kept.
func TestMemberRenewsASignedOutSession(t *testing.T) {
	m, store, account := member(t, testPass)
	pages, err := m.Pages(context.Background(), account, testLTUID, PageStandings)
	if err != nil || len(pages[PageStandings]) == 0 {
		t.Fatalf("read: %v", err)
	}
	if store.renewed != 1 {
		t.Fatalf("renewed %d times", store.renewed)
	}
	secret, err := m.Vault.Open(account.String(), Host, store.conn.Sealed)
	if err != nil || secret.Cookies["BGSLMAuthenticated"] != "yes" {
		t.Fatalf("the renewed session was not kept: %v", err)
	}
}

// A refused kept sign-in is counted, and the third locks the connection:
// no further sign-in is tried.
func TestMemberLocksAfterThreeRefusals(t *testing.T) {
	m, store, account := member(t, "changed-on-ffpc")
	for i := range hosts.MaxFailedSignIns {
		_, err := m.Pages(context.Background(), account, testLTUID, PageStandings)
		if !errors.Is(err, ErrNeedsSignIn) {
			t.Fatalf("read %d: %v", i+1, err)
		}
		if store.conn.Status != hosts.StatusLocked {
			store.conn.Status = hosts.StatusConnected // the member signs in again
		}
	}
	if store.conn.Status != hosts.StatusLocked {
		t.Fatalf("status %s after %d refusals", store.conn.Status, store.conn.FailedSignIns)
	}
	if _, err := m.Pages(context.Background(), account, testLTUID, PageStandings); !errors.Is(err, ErrNeedsSignIn) {
		t.Fatalf("a locked connection read: %v", err)
	}
	if _, err := m.Pages(context.Background(), uuid.New(), testLTUID, PageStandings); !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("another account read through this connection: %v", err)
	}
}
