package espnhost

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

const (
	goodSWID = "{00000001-0000-4000-8000-000000000001}"
	badSWID  = "{00000002-0000-4000-8000-000000000002}"
)

var goodS2 = strings.Repeat("AEB", 30) + "%2B"

// fakeESPN accepts the good cookies and refuses any other. Its one league
// is private unless public is set; a league other than it is one the
// member is not in.
type fakeESPN struct {
	reads, lists, publicReads int
	public                    bool
}

func (f *fakeESPN) MyLeagues(_ context.Context, c espn.Cookies, season int) ([]espn.MyLeague, error) {
	f.lists++
	if c.SWID != goodSWID {
		return nil, espn.ErrSignedOut
	}
	return []espn.MyLeague{{LeagueID: "48153503", Season: season, Name: "Agbo Superhero League", TeamName: "TEAM BERRY", Teams: 14}}, nil
}

func (f *fakeESPN) Read(_ context.Context, id string, _ int, c *espn.Cookies) (espn.FullLeague, error) {
	if c == nil {
		f.publicReads++
		if f.public && id == "48153503" {
			return espn.FullLeague{ID: id}, nil
		}
		return espn.FullLeague{}, espn.ErrPrivate
	}
	f.reads++
	if c.S2 != goodS2 || id != "48153503" {
		return espn.FullLeague{}, espn.ErrSignedOut
	}
	return espn.FullLeague{ID: id}, nil
}

type memStore struct {
	conn      *hosts.Connection
	refusals  int
	signedOut bool
}

func (m *memStore) Put(_ context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time) (hosts.Connection, error) {
	m.conn = &hosts.Connection{AccountID: accountID, Host: host, Status: hosts.StatusConnected, Sealed: sealed, CreatedAt: now}
	return *m.conn, nil
}

func (m *memStore) Get(context.Context, uuid.UUID, string) (hosts.Connection, error) {
	if m.conn == nil {
		return hosts.Connection{}, hosts.ErrNotConnected
	}
	return *m.conn, nil
}

func (m *memStore) Delete(context.Context, uuid.UUID, string) error {
	if m.conn == nil {
		return hosts.ErrNotConnected
	}
	m.conn = nil
	return nil
}

func (m *memStore) Refused(context.Context, uuid.UUID, string, time.Time) error {
	m.refusals++
	return nil
}

func (m *memStore) Refusals(context.Context, uuid.UUID, string, time.Time) (int, error) {
	return m.refusals, nil
}

func (m *memStore) SignedOutAt(_ context.Context, _ uuid.UUID, _ string, wrapped []byte) error {
	if m.conn == nil || string(wrapped) != string(m.conn.Sealed.WrappedKey) {
		return nil
	}
	m.signedOut = true
	m.conn.Status = hosts.StatusSignedOut
	return nil
}

func (m *memStore) Read(context.Context, uuid.UUID, string, time.Time) error { return nil }

type noneFollowed struct{}

func (noneFollowed) FollowedIDs(context.Context, uuid.UUID, string) (map[string]bool, error) {
	return map[string]bool{}, nil
}

func setup(t *testing.T) (*Service, *memStore, *fakeESPN, uuid.UUID) {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	vault, err := hosts.NewVault(hosts.OneKey(key))
	if err != nil {
		t.Fatal(err)
	}
	store, client := &memStore{}, &fakeESPN{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	member := &Member{Client: client, Store: store, Vault: vault, Now: time.Now, Log: log}
	return &Service{
		Enabled: true, Client: client, Store: store, Vault: vault, Leagues: member, Followed: noneFollowed{}, Now: time.Now, Log: log,
	}, store, client, uuid.New()
}

func call(t *testing.T, h http.HandlerFunc, id uuid.UUID, body any) (int, []byte) {
	t.Helper()
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(http.MethodGet, "/", nil)
	} else {
		raw, _ := json.Marshal(body)
		r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
	}
	r = r.WithContext(auth.WithAccount(r.Context(), auth.Account{ID: id}))
	w := httptest.NewRecorder()
	h(w, r)
	return w.Code, w.Body.Bytes()
}

// Two good cookies connect after one read of the member's leagues and one
// league; only the two cookies are kept, sealed, and the answer names the
// leagues.
func TestConnect(t *testing.T) {
	s, store, client, me := setup(t)
	status, body := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true})
	if status != http.StatusCreated {
		t.Fatalf("connect: %d %s", status, body)
	}
	var out struct {
		Data apitypes.HostConnected `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil || len(out.Data.Leagues) != 1 || *out.Data.Leagues[0].Teams != 14 {
		t.Fatalf("answer %s", body)
	}
	if strings.Contains(string(body), goodS2) || client.lists != 1 || client.reads != 1 || client.publicReads != 1 {
		t.Fatalf("answer carries the cookie, or %d lists %d reads %d public reads", client.lists, client.reads, client.publicReads)
	}
	s2, err := s.Vault.OpenSession(me.String(), Host, store.conn.Sealed)
	if err != nil || s2[keySWID] != goodSWID || s2[keyS2] != goodS2 || len(s2) != 2 {
		t.Fatalf("kept %d values, %v", len(s2), err)
	}
}

// Cookies ESPN refuses are refused in one sentence and counted; three in
// an hour pause connecting.
func TestConnectRefused(t *testing.T) {
	s, store, _, me := setup(t)
	for range 3 {
		if status, _ := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: badSWID, EspnS2: goodS2, Consent: true}); status != http.StatusUnprocessableEntity {
			t.Fatalf("refused cookies: %d", status)
		}
	}
	if status, _ := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true}); status != http.StatusLocked {
		t.Fatalf("after three refusals: %d", status)
	}
	if store.conn != nil {
		t.Fatal("a refused pair was kept")
	}
	s, _, _, me = setup(t)
	if status, _ := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: "short" + strings.Repeat("A", 40), Consent: true}); status != http.StatusUnprocessableEntity {
		t.Fatalf("an espn_s2 that ESPN refuses on a league read: %d", status)
	}
}

// What is not two cookies, or no consent, is named field by field; a
// SWID pasted without its braces is read with them.
func TestConnectChecksTheForm(t *testing.T) {
	s, _, client, me := setup(t)
	status, body := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: "nope", EspnS2: "a b", Consent: false})
	if status != http.StatusBadRequest || !strings.Contains(string(body), "swid") || !strings.Contains(string(body), "espn_s2") || !strings.Contains(string(body), "consent") {
		t.Fatalf("form: %d %s", status, body)
	}
	if client.lists != 0 {
		t.Fatal("ESPN was read for a form that does not check out")
	}
	if status, body := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: strings.Trim(goodSWID, "{}"), EspnS2: goodS2, Consent: true}); status != http.StatusCreated {
		t.Fatalf("a SWID with no braces: %d %s", status, body)
	}
	s.Enabled = false
	if status, _ := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true}); status != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", status)
	}
}

// The league list reads with the kept cookies; cookies ESPN later refuses
// mark the connection for a reconnect.
func TestLeaguesAndReconnect(t *testing.T) {
	s, store, client, me := setup(t)
	if status, _ := call(t, s.leagues, me, nil); status != http.StatusNotFound {
		t.Fatalf("not connected: %d", status)
	}
	call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true})
	if status, body := call(t, s.leagues, me, nil); status != http.StatusOK || !strings.Contains(string(body), "48153503") {
		t.Fatalf("leagues: %d %s", status, body)
	}
	sealed, _ := Seal(s.Vault, me, espn.Cookies{SWID: badSWID, S2: goodS2})
	store.conn.Sealed = sealed
	if status, _ := call(t, s.leagues, me, nil); status != http.StatusConflict || !store.signedOut {
		t.Fatalf("refused cookies: %d, signed out %v", status, store.signedOut)
	}
	if _, err := (&Member{Client: client, Store: store, Vault: s.Vault, Now: time.Now, Log: s.Log}).Cookies(context.Background(), me); !errors.Is(err, ErrReconnect) {
		t.Fatalf("a signed out connection still opens: %v", err)
	}
	r := httptest.NewRequest(http.MethodDelete, "/", nil).WithContext(auth.WithAccount(context.Background(), auth.Account{ID: me}))
	w := httptest.NewRecorder()
	hosts.Disconnect(s.Store, Host, s.Log)(w, r)
	if w.Code != http.StatusOK || store.conn != nil {
		t.Fatalf("disconnect: %d", w.Code)
	}
}

// M3: a pair proves itself only on a league the public cannot read. A
// member whose leagues are all public has nothing to connect, and the
// pair is not kept.
func TestConnectNeedsAPrivateLeagueToProveTheCookies(t *testing.T) {
	s, store, client, me := setup(t)
	client.public = true
	status, body := call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true})
	if status != http.StatusUnprocessableEntity || store.conn != nil || client.reads != 0 {
		t.Fatalf("all public: %d %s, kept %v, %d reads with cookies", status, body, store.conn != nil, client.reads)
	}
	if store.refusals != 0 {
		t.Fatal("nothing to connect counted as a refusal")
	}
}

// A league the member is not in refuses their working cookies as ESPN
// refuses cookies that no longer work: the member's own list tells the
// two apart, and only the second signs them out.
func TestReadLeagueNotTheirsKeepsTheConnection(t *testing.T) {
	s, store, client, me := setup(t)
	call(t, s.connect, me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true})
	m := &Member{Client: client, Store: store, Vault: s.Vault, Now: time.Now, Log: s.Log}
	if _, err := m.ReadLeague(context.Background(), me, "999", 2026); !errors.Is(err, espn.ErrPrivate) || store.signedOut {
		t.Fatalf("a league not theirs: %v, signed out %v", err, store.signedOut)
	}
	if _, err := m.ReadLeague(context.Background(), me, "48153503", 2026); err != nil {
		t.Fatalf("their league: %v", err)
	}
}
