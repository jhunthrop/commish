package mflhost

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/mfl/mfltest"
)

var me = uuid.MustParse("6f1d1c52-2626-4a26-9a26-0000000000b7")

// memStore is the connections table in memory, for one account.
type memStore struct {
	mu        sync.Mutex
	conn      *hosts.Connection
	refusals  int
	attempts  []attempt
	signedOut int
	reads     int
	deleted   int
}

func (m *memStore) PutConsented(_ context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time, proven bool, shown int) (hosts.Connection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.conn = &hosts.Connection{AccountID: accountID, Host: host, Status: hosts.StatusConnected, Sealed: sealed, CreatedAt: now,
		Proven: proven, ConsentVersion: max(min(shown, hosts.MFLConsentVersion), 1)}
	return *m.conn, nil
}

func (m *memStore) Get(context.Context, uuid.UUID, string) (hosts.Connection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.conn == nil {
		return hosts.Connection{}, hosts.ErrNotConnected
	}
	return *m.conn, nil
}

func (m *memStore) Delete(context.Context, uuid.UUID, string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.conn == nil {
		return hosts.ErrNotConnected
	}
	m.conn, m.deleted = nil, m.deleted+1
	return nil
}

func (m *memStore) Refused(context.Context, uuid.UUID, string, time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.refusals++
	return nil
}

func (m *memStore) Refusals(context.Context, uuid.UUID, string, time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.refusals, nil
}

type attempt struct {
	key     []byte
	refused bool
}

func (m *memStore) LoginAttempt(_ context.Context, _ string, key []byte, _ time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.attempts = append(m.attempts, attempt{key: key})
	return int64(len(m.attempts) - 1), nil
}

func (m *memStore) LoginRefused(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.attempts[id].refused = true
	return nil
}

func (m *memStore) LoginAttempts(_ context.Context, _ string, key []byte, _ time.Time) (int, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	refused := 0
	for _, a := range m.attempts {
		if a.refused && bytes.Equal(a.key, key) {
			refused++
		}
	}
	return len(m.attempts), refused, nil
}

func (m *memStore) SignedOutAt(_ context.Context, _ uuid.UUID, _ string, wrapped []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.conn != nil && bytes.Equal(m.conn.Sealed.WrappedKey, wrapped) {
		m.conn.Status = hosts.StatusSignedOut
	}
	m.signedOut++
	return nil
}

func (m *memStore) Read(context.Context, uuid.UUID, string, time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reads++
	return nil
}

type allow struct{ ok bool }

func (a allow) Allowed(_ context.Context, _ uuid.UUID, host, kind string) (bool, error) {
	return a.ok && host == Host && kind == "lineup", nil
}

type follows struct{}

func (follows) FollowedIDs(context.Context, uuid.UUID, string) (map[string]bool, error) {
	return map[string]bool{hosts.FollowKey(mfltest.LeagueID, mfltest.Season): true}, nil
}

type rig struct {
	svc   *Service
	srv   *mfltest.Server
	store *memStore
	vault *hosts.Vault
	logs  *bytes.Buffer
	now   time.Time
}

func newRig(t *testing.T) *rig {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	vault, err := hosts.NewVault(hosts.OneKey(key))
	if err != nil {
		t.Fatal(err)
	}
	srv := mfltest.New(t)
	r := &rig{srv: srv, store: &memStore{}, vault: vault, logs: &bytes.Buffer{}, now: time.Date(2026, 10, 18, 15, 0, 0, 0, time.UTC)}
	log := slog.New(slog.NewTextHandler(r.logs, nil))
	client := srv.Client()
	member := &Member{Client: client, Store: r.store, Vault: vault, Now: func() time.Time { return r.now }, Log: log}
	r.svc = &Service{Ready: true, Writes: true, Proofs: allow{}, Client: client, Store: r.store, Vault: vault, Leagues: member,
		Followed: follows{}, UsernameKey: []byte("a username key of thirty-two b!!"), Now: func() time.Time { return r.now }, Log: log}
	return r
}

func (r *rig) call(t *testing.T, h http.HandlerFunc, body any) (int, apitypes.Envelope, []byte) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithAccount(context.Background(), auth.Account{ID: me}))
	rec := httptest.NewRecorder()
	h(rec, req)
	var env apitypes.Envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	data, _ := json.Marshal(env.Data)
	return rec.Code, env, data
}

func good() apitypes.MFLConnectInput {
	return apitypes.MFLConnectInput{Username: mfltest.Username, Password: mfltest.Password, Consent: true, ConsentVersion: 1}
}

// Connecting exchanges the pair once and keeps the session alone, sealed,
// at the words the page showed, and answers the member's leagues.
func TestConnectKeepsTheSessionNeverThePassword(t *testing.T) {
	r := newRig(t)
	code, env, data := r.call(t, r.svc.connect, good())
	if code != http.StatusCreated {
		t.Fatalf("%d %+v", code, env.Error)
	}
	var out apitypes.HostConnected
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	if out.Connection.Host != apitypes.ConnectedHostMfl || !out.Connection.Proven || len(out.Leagues) != 2 ||
		out.Leagues[0].TeamName != "Hunthrop" || out.Leagues[0].Attached == nil || !*out.Leagues[0].Attached {
		t.Fatalf("%+v", out)
	}
	conn := r.store.conn
	if conn == nil || conn.ConsentVersion != hosts.MFLConsentVersion {
		t.Fatalf("kept %+v", conn)
	}
	s, err := r.vault.OpenSession(me.String(), Host, conn.Sealed)
	if err != nil || s[keyUserID] != mfltest.Session {
		t.Fatalf("the kept session: %v", err)
	}
	if _, err := r.vault.OpenRenewal(me.String(), Host, conn.Sealed); err != nil {
		t.Fatalf("the second part: %v", err)
	}
	for _, b := range [][]byte{conn.Sealed.SessionCT, conn.Sealed.SignInCT, data, r.logs.Bytes()} {
		if bytes.Contains(b, []byte(mfltest.Password)) || bytes.Contains(b, []byte(mfltest.Session)) || bytes.Contains(b, []byte(mfltest.Username)) {
			t.Fatalf("a credential in the clear: %s", b)
		}
	}
	plain, _ := r.vault.OpenRenewal(me.String(), Host, conn.Sealed)
	if len(plain) != 0 {
		t.Fatalf("something kept beside the session: %d keys", len(plain))
	}
	for _, q := range r.srv.LoginQueries() {
		if q != "" {
			t.Fatalf("the login carried a query: %q", q)
		}
	}
}

// The expiry MyFantasyLeague states is kept with the session, and a
// session past it is a reconnect, signed out.
func TestExpiryKeptAndHeld(t *testing.T) {
	r := newRig(t)
	expires := r.now.Add(48 * time.Hour)
	r.srv.Set(func(s *mfltest.Server) { s.Expires = expires })
	if code, env, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
		t.Fatalf("%d %+v", code, env.Error)
	}
	m := r.svc.Leagues.(*Member)
	if sess, err := m.Session(context.Background(), me); err != nil || !sess.Expires.Equal(expires) {
		t.Fatalf("%v %v", err, sess.Expires)
	}
	r.now = expires.Add(time.Minute)
	if _, err := m.Session(context.Background(), me); !errors.Is(err, ErrReconnect) || r.store.conn.Status != hosts.StatusSignedOut {
		t.Fatalf("an expired session answered %v, status %s", err, r.store.conn.Status)
	}
	// A session MyFantasyLeague states no expiry for, or one past ours, is
	// kept for maxSessionLife at most.
	for _, stated := range []time.Time{{}, r.now.Add(5 * maxSessionLife)} {
		r = newRig(t)
		r.srv.Set(func(s *mfltest.Server) { s.Expires = stated })
		if code, _, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
			t.Fatal(code)
		}
		sess, err := r.svc.Leagues.(*Member).Session(context.Background(), me)
		if err != nil || !sess.Expires.Equal(r.now.Add(maxSessionLife)) {
			t.Fatalf("stated %v: kept %v, %v", stated, sess.Expires, err)
		}
	}
}

// The connect is closed while the switch is off, except to the accounts
// on its proof list, and with no key at all.
func TestConnectOpenOnlyWithTheSwitchOrTheList(t *testing.T) {
	cases := []struct {
		name          string
		ready, writes bool
		allowed       bool
		want          int
	}{
		{"no key", false, true, true, http.StatusServiceUnavailable},
		{"switch off, not listed", true, false, false, http.StatusServiceUnavailable},
		{"switch off, listed", true, false, true, http.StatusCreated},
		{"switch on", true, true, false, http.StatusCreated},
	}
	for _, c := range cases {
		r := newRig(t)
		r.svc.Ready, r.svc.Writes, r.svc.Proofs = c.ready, c.writes, allow{c.allowed}
		if code, env, _ := r.call(t, r.svc.connect, good()); code != c.want {
			t.Errorf("%s: %d %+v", c.name, code, env.Error)
		}
		if c.want != http.StatusCreated && len(r.srv.LoginQueries()) != 0 {
			t.Errorf("%s: a login was sent", c.name)
		}
		// GET /hosts lists it to a listed account only while the switch is
		// off: with it on it is open to all.
		more, err := r.svc.OpenTo(context.Background(), me)
		if listed := c.ready && !c.writes && c.allowed; err != nil || (len(more) == 1) != listed {
			t.Errorf("%s: open to %v %v", c.name, more, err)
		}
	}
}

// The form: both fields and the consent, at a version; nothing sent
// otherwise.
func TestConnectForm(t *testing.T) {
	r := newRig(t)
	bad := []apitypes.MFLConnectInput{
		{Password: mfltest.Password, Consent: true, ConsentVersion: 1},
		{Username: mfltest.Username, Consent: true, ConsentVersion: 1},
		{Username: mfltest.Username, Password: mfltest.Password, ConsentVersion: 1},
		{Username: mfltest.Username, Password: mfltest.Password, Consent: true},
		{Username: strings.Repeat("u", 129), Password: mfltest.Password, Consent: true, ConsentVersion: 1},
	}
	for i, in := range bad {
		if code, _, _ := r.call(t, r.svc.connect, in); code != http.StatusBadRequest {
			t.Errorf("form %d: %d", i, code)
		}
	}
	if n := len(r.srv.LoginQueries()); n != 0 {
		t.Fatalf("%d logins sent for bad forms", n)
	}
}

// A refused pair is kept as a refusal and says so in MyFantasyLeague's
// name; three in the hour pause connecting with nothing sent.
func TestConnectRefusedAndPaused(t *testing.T) {
	r := newRig(t)
	in := good()
	in.Password = "wrong"
	for range 3 {
		code, env, _ := r.call(t, r.svc.connect, in)
		if code != http.StatusUnprocessableEntity || env.Error.Message != refusedWords {
			t.Fatalf("%d %+v", code, env.Error)
		}
	}
	code, env, _ := r.call(t, r.svc.connect, good())
	if code != http.StatusLocked || env.Error.Message != pausedWords || len(r.srv.LoginQueries()) != 3 {
		t.Fatalf("%d %+v, %d logins", code, env.Error, len(r.srv.LoginQueries()))
	}
	if strings.Contains(r.logs.String(), "wrong") || r.store.conn != nil {
		t.Fatal("the refused password logged, or something kept")
	}
}

// The site's sign-ins are capped per hour across every account, with an
// alert in the log, and nothing is sent past the cap.
func TestConnectCapAcrossAccounts(t *testing.T) {
	r := newRig(t)
	for range maxAttemptsPerHour {
		_, _ = r.store.LoginAttempt(context.Background(), Host, make([]byte, 32), r.now)
	}
	code, env, _ := r.call(t, r.svc.connect, good())
	if code != http.StatusLocked || env.Error.Message != busyWords || len(r.srv.LoginQueries()) != 0 {
		t.Fatalf("%d %+v, %d logins", code, env.Error, len(r.srv.LoginQueries()))
	}
	if !strings.Contains(r.logs.String(), "level=ERROR") || !strings.Contains(r.logs.String(), "connect cap") {
		t.Fatalf("no alert: %s", r.logs.String())
	}
}

// Refusals are counted per username, whichever account sends it, by a
// keyed hash never the username itself; a refused username is paused in
// the same words as the site's cap, so the answer never says which.
func TestConnectRefusalsPerUsername(t *testing.T) {
	r := newRig(t)
	in := good()
	in.Password = "wrong"
	for range maxUsernameRefusals {
		r.store.refusals = 0 // another account each time
		if code, _, _ := r.call(t, r.svc.connect, in); code != http.StatusUnprocessableEntity {
			t.Fatal(code)
		}
	}
	r.store.refusals = 0
	other := good()
	other.Username = "  " + strings.ToUpper(mfltest.Username) + " "
	code, env, _ := r.call(t, r.svc.connect, other)
	if code != http.StatusLocked || env.Error.Message != busyWords || len(r.srv.LoginQueries()) != maxUsernameRefusals {
		t.Fatalf("%d %+v, %d logins", code, env.Error, len(r.srv.LoginQueries()))
	}
	for _, a := range r.store.attempts {
		if len(a.key) != 32 || bytes.Contains(a.key, []byte("founder")) {
			t.Fatalf("a username kept, not its keyed hash: %x", a.key)
		}
	}
	// Another username is not paused by these.
	fresh := good()
	fresh.Username = "someone@example.com"
	if code, _, _ := r.call(t, r.svc.connect, fresh); code == http.StatusLocked {
		t.Fatal("another username paused")
	}
	// A bad username and a bad password read the same.
	r2 := newRig(t)
	badName := good()
	badName.Username = "nobody@example.com"
	_, e1, _ := r2.call(t, r2.svc.connect, badName)
	_, e2, _ := r2.call(t, r2.svc.connect, in)
	if e1.Error == nil || e2.Error == nil || e1.Error.Message != e2.Error.Message {
		t.Fatalf("%+v %+v", e1.Error, e2.Error)
	}
}

// The leagues route reads with the kept session; a session
// MyFantasyLeague refuses signs out and asks to connect again.
func TestLeagues(t *testing.T) {
	r := newRig(t)
	if code, env, _ := r.call(t, r.svc.leagues, nil); code != http.StatusNotFound || env.Error.Message != notConnectedWords {
		t.Fatalf("not connected: %d %+v", code, env.Error)
	}
	if code, _, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
		t.Fatal(code)
	}
	code, _, data := r.call(t, r.svc.leagues, nil)
	var list []apitypes.HostLeague
	if err := json.Unmarshal(data, &list); err != nil || code != http.StatusOK || len(list) != 2 {
		t.Fatalf("%d %s", code, data)
	}
	// Behind the switch and its list, as connecting is: the kill switch
	// stops the reads too.
	r.svc.Writes = false
	if code, _, _ := r.call(t, r.svc.leagues, nil); code != http.StatusServiceUnavailable {
		t.Fatalf("switch off, not listed: %d", code)
	}
	r.svc.Writes = true
	r.srv.Set(func(s *mfltest.Server) { s.SessionRefused = true })
	if code, env, _ := r.call(t, r.svc.leagues, nil); code != http.StatusConflict || env.Error.Message != reconnectWords {
		t.Fatalf("refused: %d %+v", code, env.Error)
	}
	if r.store.conn.Status != hosts.StatusSignedOut {
		t.Fatal("a refused session stayed connected")
	}
}

// The member's lineup read signs a refused session out, and a good read
// answers the session it read with.
func TestMemberLineup(t *testing.T) {
	r := newRig(t)
	m := r.svc.Leagues.(*Member)
	if _, _, err := m.Lineup(context.Background(), me, mfltest.LeagueID, mfltest.Season); !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("not connected: %v", err)
	}
	if code, _, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
		t.Fatal(code)
	}
	l, sess, err := m.Lineup(context.Background(), me, mfltest.LeagueID, mfltest.Season)
	if err != nil || l.Franchise != mfltest.Franchise || sess.UserID != mfltest.Session {
		t.Fatalf("%v %+v", err, l)
	}
	r.srv.Set(func(s *mfltest.Server) { s.SessionRefused = true })
	if _, _, err := m.Lineup(context.Background(), me, mfltest.LeagueID, mfltest.Season); !errors.Is(err, ErrReconnect) ||
		r.store.conn.Status != hosts.StatusSignedOut {
		t.Fatalf("refused: %v", err)
	}
	if _, err := m.Session(context.Background(), me); !errors.Is(err, ErrReconnect) {
		t.Fatalf("a signed-out connection opened: %v", err)
	}
}

// The member's pending trades read answers their franchise with the
// offers, refuses a league they are not in, and signs a refused session
// out (Lane 279).
func TestMemberPendingTrades(t *testing.T) {
	r := newRig(t)
	m := r.svc.Leagues.(*Member)
	if _, _, err := m.PendingTrades(context.Background(), me, mfltest.LeagueID, mfltest.Season); !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("not connected: %v", err)
	}
	if code, _, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
		t.Fatal(code)
	}
	franchise, list, err := m.PendingTrades(context.Background(), me, mfltest.LeagueID, mfltest.Season)
	if err != nil || franchise != mfltest.Franchise || len(list) != 3 {
		t.Fatalf("%v %d %+v", err, franchise, list)
	}
	if _, _, err := m.PendingTrades(context.Background(), me, "30030", mfltest.Season); !errors.Is(err, mfl.ErrNotYourTeam) {
		t.Fatalf("another league: %v", err)
	}
	r.srv.Set(func(s *mfltest.Server) { s.SessionRefused = true })
	if _, _, err := m.PendingTrades(context.Background(), me, mfltest.LeagueID, mfltest.Season); !errors.Is(err, ErrReconnect) ||
		r.store.conn.Status != hosts.StatusSignedOut {
		t.Fatalf("refused: %v", err)
	}
}

// Disconnecting deletes the kept session.
func TestDisconnect(t *testing.T) {
	r := newRig(t)
	if code, _, _ := r.call(t, r.svc.connect, good()); code != http.StatusCreated {
		t.Fatal(code)
	}
	var del http.HandlerFunc
	for _, route := range r.svc.Routes() {
		if route.Method == http.MethodDelete && route.Path == "/hosts/mfl" {
			del = route.Handler
		}
	}
	if code, _, _ := r.call(t, del, nil); code != http.StatusOK || r.store.conn != nil || r.store.deleted != 1 {
		t.Fatalf("%d %+v", code, r.store.conn)
	}
}
