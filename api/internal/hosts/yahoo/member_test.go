package yahoo

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// memStore is one account's connection in memory.
type memStore struct {
	mu        sync.Mutex
	conn      hosts.Connection
	signedOut bool
	reads     int
	locks     int
}

func (s *memStore) Get(_ context.Context, _ uuid.UUID, _ string) (hosts.Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn, nil
}

func (s *memStore) TokensKept(_ context.Context, _ uuid.UUID, _ string, wrapped, session, renewal []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if bytes.Equal(wrapped, s.conn.Sealed.WrappedKey) {
		s.conn.Sealed.SessionCT, s.conn.Sealed.SignInCT = session, renewal
	}
	return nil
}

func (s *memStore) Locked(ctx context.Context, _ uuid.UUID, _ string, fn func(context.Context) error) error {
	s.mu.Lock()
	s.locks++
	s.mu.Unlock()
	return fn(ctx)
}

func (s *memStore) SignedOutAt(_ context.Context, _ uuid.UUID, _ string, wrapped []byte) error {
	if !bytes.Equal(wrapped, s.conn.Sealed.WrappedKey) {
		return nil
	}
	return s.SignedOut(context.Background(), uuid.Nil, "")
}

func (s *memStore) SignedOut(context.Context, uuid.UUID, string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signedOut = true
	s.conn.Status = hosts.StatusSignedOut
	return nil
}

func (s *memStore) Read(context.Context, uuid.UUID, string, time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	return nil
}

// fakeRefresher hands out the next access token, or refuses.
type fakeRefresher struct {
	refuse bool
	calls  int
	sent   []string
}

func (f *fakeRefresher) Refresh(_ context.Context, refresh string, now time.Time) (Tokens, error) {
	f.calls++
	f.sent = append(f.sent, refresh)
	if f.refuse {
		return Tokens{}, ErrRefused
	}
	return Tokens{Access: "fresh-access", Refresh: "fresh-refresh", Expiry: now.Add(time.Hour)}, nil
}

// yahooAPI serves the fixtures to a request carrying the good token, and
// 401 to any other.
func yahooAPI(t *testing.T, good string) (*Client, *[]string) {
	t.Helper()
	return yahooAPIWith(t, good, false)
}

// yahooAPIWith is yahooAPI whose waiver wire answers 400 when failWaivers.
func yahooAPIWith(t *testing.T, good string, failWaivers bool) (*Client, *[]string) {
	t.Helper()
	var paths []string
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer "+good {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		name := ""
		switch {
		case strings.HasSuffix(r.URL.Path, "/leagues"):
			name = "yahoo-my-leagues.xml"
		case strings.HasSuffix(r.URL.Path, "games;game_keys=nfl/teams"):
			name = "yahoo-my-teams.xml"
		case strings.Contains(r.URL.Path, "games;game_codes=nfl"):
			name = "yahoo-games-2026.xml"
		case strings.Contains(r.URL.Path, "/transactions;team_key=") && strings.HasSuffix(r.URL.Path, ";type=pending_trade"):
			name = "yahoo-pending-trades.xml"
		case strings.Contains(r.URL.Path, "/players;status=W") && failWaivers:
			w.WriteHeader(http.StatusBadRequest)
			return
		case strings.Contains(r.URL.Path, "/players;status=W"):
			name = "yahoo-league-waivers.xml"
		case strings.HasSuffix(r.URL.Path, "/teams;out=roster"):
			name = "yahoo-league-rosters.xml"
		case strings.Contains(r.URL.Path, ";out=settings"):
			name = "yahoo-league-head.xml"
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write(fixture(t, name))
	}))
	t.Cleanup(srv.Close)
	c := New()
	c.Base = srv.URL
	c.Pace = LocalPace(time.Microsecond)
	return c, &paths
}

func testVault(t *testing.T) *hosts.Vault {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	v, err := hosts.NewVault(hosts.OneKey(key))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func member(t *testing.T, access string, expiry, now time.Time, good string, ref *fakeRefresher) (*Member, *memStore, uuid.UUID, *[]string) {
	t.Helper()
	v := testVault(t)
	id := uuid.New()
	sealed, err := Seal(v, id, Tokens{Access: access, Refresh: "kept-refresh", Expiry: expiry})
	if err != nil {
		t.Fatal(err)
	}
	store := &memStore{conn: hosts.Connection{AccountID: id, Host: Host, Status: hosts.StatusConnected, Sealed: sealed}}
	client, paths := yahooAPI(t, good)
	m := &Member{Client: client, OAuth: ref, Store: store, Vault: v, Now: func() time.Time { return now }, Log: quiet()}
	return m, store, id, paths
}

// A token well inside its hour reads with no refresh.
func TestMemberReadsWithTheKeptToken(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	ref := &fakeRefresher{}
	m, store, id, _ := member(t, "kept-access", now.Add(time.Hour), now, "kept-access", ref)
	l, err := m.ReadLeague(context.Background(), id, 2026, "128934")
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Teams) != 10 || ref.calls != 0 || store.reads != 1 || len(l.Waivers) != 3 {
		t.Fatalf("%d teams, %d refreshes, %d reads noted, %d on waivers", len(l.Teams), ref.calls, store.reads, len(l.Waivers))
	}
}

// A token within five minutes of its expiry is refreshed first, and the
// new tokens are kept under the row's own key.
func TestMemberRefreshesNearExpiry(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	ref := &fakeRefresher{}
	m, store, id, _ := member(t, "old-access", now.Add(4*time.Minute), now, "fresh-access", ref)
	before := store.conn.Sealed
	if _, err := m.Leagues(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if ref.calls != 1 || ref.sent[0] != "kept-refresh" || store.locks != 1 {
		t.Fatalf("%d refreshes with %v, %d locks taken", ref.calls, ref.sent, store.locks)
	}
	after := store.conn.Sealed
	if bytes.Equal(after.SessionCT, before.SessionCT) || !bytes.Equal(after.WrappedKey, before.WrappedKey) {
		t.Fatal("the refreshed tokens were not kept under the row's own key")
	}
	s, err := m.Vault.OpenSession(id.String(), Host, after)
	if err != nil || s[keyAccess] != "fresh-access" {
		t.Fatalf("kept session: %v", err)
	}
	r, err := m.Vault.OpenRenewal(id.String(), Host, after)
	if err != nil || r[keyRefresh] != "fresh-refresh" {
		t.Fatalf("kept renewal: %v", err)
	}
}

// A token Yahoo refuses before its expiry is refreshed once and the read
// tried again.
func TestMemberRefreshesOnARefusal(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	ref := &fakeRefresher{}
	m, _, id, _ := member(t, "revoked-access", now.Add(time.Hour), now, "fresh-access", ref)
	if _, err := m.ReadLeague(context.Background(), id, 0, "128934"); err != nil {
		t.Fatal(err)
	}
	if ref.calls != 1 {
		t.Fatalf("%d refreshes", ref.calls)
	}
}

// A refresh Yahoo refuses marks the connection for a reconnect, and the
// next read does not try again.
func TestMemberRefusedRefreshNeedsAReconnect(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	ref := &fakeRefresher{refuse: true}
	m, store, id, paths := member(t, "old-access", now.Add(time.Minute), now, "never", ref)
	if _, err := m.ReadLeague(context.Background(), id, 2026, "128934"); !errors.Is(err, ErrReconnect) {
		t.Fatalf("refused refresh: %v", err)
	}
	if !store.signedOut || len(*paths) != 0 {
		t.Fatalf("signed out %v, %d reads sent", store.signedOut, len(*paths))
	}
	if _, err := m.ReadLeague(context.Background(), id, 2026, "128934"); !errors.Is(err, ErrReconnect) || ref.calls != 1 {
		t.Fatalf("a second read: %v after %d refreshes", err, ref.calls)
	}
}

// The game key for a season is read once a process.
func TestMemberReadsTheGameKeyOnce(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	m, _, id, paths := member(t, "kept-access", now.Add(time.Hour), now, "kept-access", &fakeRefresher{})
	for range 2 {
		if _, err := m.ReadLeague(context.Background(), id, 2026, "128934"); err != nil {
			t.Fatal(err)
		}
	}
	games, leagues := 0, 0
	for _, p := range *paths {
		if strings.Contains(p, "games;game_codes=nfl;seasons=2026") {
			games++
		}
		if strings.Contains(p, "league/470.l.128934") {
			leagues++
		}
	}
	if games != 1 || leagues != 6 {
		t.Fatalf("%d game reads in %v", games, *paths)
	}
}

// A refresh another process made while this one waited for the lock is
// used as it is: Yahoo is not asked again.
func TestMemberUsesARefreshMadeElsewhere(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	ref := &fakeRefresher{}
	m, store, id, _ := member(t, "old-access", now.Add(time.Minute), now, "elsewhere-access", ref)
	// Another process kept fresh tokens; this read began with the old row.
	fresh, err := m.Vault.ResealTokens(id.String(), Host, store.conn.Sealed,
		session(Tokens{Access: "elsewhere-access", Expiry: now.Add(time.Hour)}), hosts.Session{keyRefresh: "r2"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.refresh(context.Background(), id, "")
	if err != nil || got != "fresh-access" {
		t.Fatalf("an old row near its expiry: %q %v", got, err)
	}
	store.conn.Sealed = fresh
	got, err = m.refresh(context.Background(), id, "")
	if err != nil || got != "elsewhere-access" {
		t.Fatalf("a fresh row: %q %v", got, err)
	}
	if ref.calls != 1 {
		t.Fatalf("%d refreshes, want the first alone", ref.calls)
	}
}

// A sign-out from a read of the old connection never marks a connection
// made again since.
func TestSignOutSparesAReconnect(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	m, store, id, _ := member(t, "a", now.Add(time.Hour), now, "a", &fakeRefresher{})
	m.signedOut(context.Background(), id, []byte("an older key"), "test")
	if store.signedOut {
		t.Fatal("a reconnected connection was signed out by an old read")
	}
}

// N1: a waiver wire Yahoo will not answer leaves waiver status unknown for
// the read; the league reads whole without it.
func TestMemberReadsTheLeagueWithoutItsWaiverWire(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	m, _, id, _ := member(t, "kept-access", now.Add(time.Hour), now, "kept-access", &fakeRefresher{})
	m.Client, _ = yahooAPIWith(t, "kept-access", true)
	l, err := m.ReadLeague(context.Background(), id, 2026, "128934")
	if err != nil {
		t.Fatalf("a failed waiver wire failed the league: %v", err)
	}
	if len(l.Teams) != 10 || l.Waivers != nil || !errors.Is(l.WaiversErr, ErrNoSuchLeague) {
		t.Fatalf("%d teams, waivers %v, err %v", len(l.Teams), l.Waivers, l.WaiversErr)
	}
}
