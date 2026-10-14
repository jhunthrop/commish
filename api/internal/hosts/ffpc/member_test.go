package ffpc

import (
	"bytes"
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

func (m *memoryConnections) SessionKept(_ context.Context, _ uuid.UUID, _ string, wrappedKey, sessionCT []byte) error {
	if !bytes.Equal(m.conn.Sealed.WrappedKey, wrappedKey) {
		return nil
	}
	m.conn.Sealed.SessionCT = sessionCT
	m.conn.Status = hosts.StatusConnected
	m.kept++
	return nil
}

// ClaimSignIn holds the store's rule: one claim a window, connected only.
func (m *memoryConnections) ClaimSignIn(_ context.Context, _ uuid.UUID, _ string, at time.Time, every time.Duration) (bool, error) {
	if m.conn.Status != hosts.StatusConnected || (m.conn.LastSignInAt != nil && at.Sub(*m.conn.LastSignInAt) < every) {
		return false, nil
	}
	m.conn.LastSignInAt = &at
	m.tries++
	return true, nil
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

// Two processes find the same expired session. The first claims the
// sign-in and mends it. The second, holding the row as it was before,
// loses the claim, re-reads the row once, reads with the mended session,
// and never signs in or signs the member out.
func TestTwoProcessesOneSignIn(t *testing.T) {
	h := newMember(t, testPass)
	stale := h.store.conn
	if err := h.read(); err != nil {
		t.Fatal(err)
	}
	other := &Member{Client: h.m.Client, Store: h.store, Vault: h.m.Vault, Now: h.m.Now, Log: h.m.Log}
	read := func(jar Cookies) (Cookies, error) {
		_, next, err := other.Client.Page(context.Background(), jar, PageStandings, testLTUID)
		return next, err
	}
	jar, _, err := other.mend(context.Background(), h.acct, stale, read)
	if err != nil || jar == nil {
		t.Fatalf("the second process: %v", err)
	}
	if h.fake.signIns != 1 || h.store.conn.Status != hosts.StatusConnected {
		t.Fatalf("%d sign-ins, status %s", h.fake.signIns, h.store.conn.Status)
	}
}

// A read that loses the claim while the winner's sign-in is still in
// flight gives way with a transient error: the member is not signed out,
// and nothing signs in twice.
func TestLoserGivesWayToASignInInFlight(t *testing.T) {
	h := newMember(t, testPass)
	claimed := h.clock.Add(-10 * time.Second) // another process claimed it ten seconds ago
	h.store.conn.LastSignInAt = &claimed
	err := h.read()
	if !errors.Is(err, ErrUnavailable) || errors.Is(err, ErrNeedsSignIn) {
		t.Fatalf("the loser's read: %v", err)
	}
	if h.store.conn.Status != hosts.StatusConnected || h.fake.signIns != 0 {
		t.Fatalf("status %s after %d sign-ins", h.store.conn.Status, h.fake.signIns)
	}
	// Past the in-flight minute with the session still unchanged, the
	// winner never kept one: the member is signed out.
	*h.clock = h.clock.Add(SignInInFlight)
	if err := h.read(); !errors.Is(err, ErrNeedsSignIn) {
		t.Fatalf("after the minute: %v", err)
	}
	// A session kept afterwards (the winner landing late) signs the member
	// back in.
	resealed, _ := h.m.Vault.Reseal(h.acct.String(), Host, h.store.conn.Sealed, hosts.Session{"BGSLMAuthenticated": "yes"})
	_ = h.store.SessionKept(context.Background(), h.acct, Host, h.store.conn.Sealed.WrappedKey, resealed.SessionCT)
	if h.store.conn.Status != hosts.StatusConnected {
		t.Fatalf("a kept session left status %s", h.store.conn.Status)
	}
}
