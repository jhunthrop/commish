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

// memoryConnections is hosts.Store in memory.
type memoryConnections struct {
	conn  hosts.Connection
	kept  int
	tries int
}

func (m *memoryConnections) Get(_ context.Context, accountID uuid.UUID, _ string) (hosts.Connection, error) {
	if m.conn.AccountID != accountID {
		return hosts.Connection{}, hosts.ErrNotConnected
	}
	return m.conn, nil
}

func (m *memoryConnections) SessionKept(_ context.Context, _ uuid.UUID, _ string, sealed hosts.Sealed) error {
	m.conn.Sealed = sealed
	m.kept++
	return nil
}

func (m *memoryConnections) SignInTried(_ context.Context, _ uuid.UUID, _ string, at time.Time) error {
	m.conn.LastSignInAt = &at
	m.tries++
	return nil
}

func (m *memoryConnections) SignedOut(context.Context, uuid.UUID, string) error {
	m.conn.Status = hosts.StatusSignedOut
	return nil
}

func (m *memoryConnections) Read(context.Context, uuid.UUID, string, time.Time) error { return nil }

type memberHarness struct {
	m     *Member
	store *memoryConnections
	fake  *fakeFFPC
	acct  uuid.UUID
	clock *time.Time
}

func newMember(t *testing.T, password string) memberHarness {
	t.Helper()
	c, fake := testClient(t)
	vault, err := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	acct := uuid.New()
	// A session FFPC no longer honors, and the kept sign-in.
	sealed, err := vault.Seal(acct.String(), Host, hosts.Session{"BGSLMSession": "old"}, hosts.SignIn{Username: testUser, Password: password})
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryConnections{conn: hosts.Connection{AccountID: acct, Host: Host, Status: hosts.StatusConnected, Sealed: sealed}}
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	h := memberHarness{store: store, fake: fake, acct: acct, clock: &now}
	h.m = &Member{Client: c, Store: store, Vault: vault, Now: func() time.Time { return *h.clock }, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return h
}

func (h memberHarness) read() error {
	_, err := h.m.Pages(context.Background(), h.acct, testLTUID, PageStandings)
	return err
}

// A signed-out session is renewed once with the kept sign-in and kept.
func TestMemberRenewsASignedOutSession(t *testing.T) {
	h := newMember(t, testPass)
	if err := h.read(); err != nil {
		t.Fatalf("read: %v", err)
	}
	if h.store.tries != 1 || h.store.kept != 1 || h.store.conn.Status != hosts.StatusConnected {
		t.Fatalf("%d sign-ins, %d sessions kept, status %s", h.store.tries, h.store.kept, h.store.conn.Status)
	}
	session, err := h.m.Vault.OpenSession(h.acct.String(), Host, h.store.conn.Sealed)
	if err != nil || session["BGSLMAuthenticated"] != "yes" {
		t.Fatalf("the renewed session was not kept: %v", err)
	}
}

// A renewal that does not mend the read signs the connection out, and
// nothing signs in again: two reads, exactly one sign-in.
func TestStillSentAwayAfterARenewalStops(t *testing.T) {
	h := newMember(t, testPass)
	h.fake.stillOut = true
	for i := range 2 {
		if err := h.read(); !errors.Is(err, ErrNeedsSignIn) {
			t.Fatalf("read %d: %v", i+1, err)
		}
	}
	if h.fake.signIns != 1 || h.store.conn.Status != hosts.StatusSignedOut {
		t.Fatalf("%d sign-ins, status %s", h.fake.signIns, h.store.conn.Status)
	}
}

// At most one kept sign-in a six hours, even when the member reconnects
// the session in between.
func TestOneSignInASixHours(t *testing.T) {
	h := newMember(t, testPass)
	if err := h.read(); err != nil {
		t.Fatal(err)
	}
	// FFPC signs the session out again an hour later.
	*h.clock = h.clock.Add(time.Hour)
	stale, _ := h.m.Vault.Reseal(h.acct.String(), Host, h.store.conn.Sealed, hosts.Session{"BGSLMSession": "old"})
	h.store.conn.Sealed = stale
	if err := h.read(); !errors.Is(err, ErrNeedsSignIn) {
		t.Fatalf("a second renewal inside six hours: %v", err)
	}
	if h.fake.signIns != 1 || h.store.conn.Status != hosts.StatusSignedOut {
		t.Fatalf("%d sign-ins, status %s", h.fake.signIns, h.store.conn.Status)
	}
}

// A refused kept sign-in, or a sign-in page we do not know, signs out at
// once with no retry; a signed-out connection is never read.
func TestRefusalAndChangedFormSignOut(t *testing.T) {
	for _, tc := range []struct {
		name      string
		password  string
		challenge bool
		posts     int
	}{
		{"refused", "changed-on-ffpc", false, 1},
		{"changed form", testPass, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newMember(t, tc.password)
			h.fake.challenge = tc.challenge
			if err := h.read(); !errors.Is(err, ErrNeedsSignIn) {
				t.Fatalf("read: %v", err)
			}
			if err := h.read(); !errors.Is(err, ErrNeedsSignIn) {
				t.Fatalf("a signed-out connection read: %v", err)
			}
			if h.fake.signIns != tc.posts || h.store.conn.Status != hosts.StatusSignedOut {
				t.Fatalf("%d posts, status %s", h.fake.signIns, h.store.conn.Status)
			}
		})
	}
	h := newMember(t, testPass)
	if _, err := h.m.Pages(context.Background(), uuid.New(), testLTUID, PageStandings); !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("another account read through this connection: %v", err)
	}
}
