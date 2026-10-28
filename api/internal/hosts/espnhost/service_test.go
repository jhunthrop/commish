package espnhost

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	// agbo is the recorded league the fan fixture lists; public is a
	// second league a variant of the fixture adds.
	agbo   = "48153503"
	public = "1081607624"
)

var goodS2 = strings.Repeat("AEB", 30) + "%2B"

// fanFixture is the fan API's recorded shape, listing agbo this season,
// with extra leagues added to its list as variants of it.
func fanFixture(t *testing.T, extra ...string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "espn", "testdata", "fan-2026.json"))
	if err != nil {
		t.Fatal(err)
	}
	entries := ""
	for _, id := range extra {
		entries += fmt.Sprintf(`{"metaData":{"entry":{"abbrev":"ffl","seasonId":2026,"entryLocation":"Team","entryNickname":"%s",`+
			`"groups":[{"groupId":%s,"groupName":"League %s","groupSize":10}]}}},`, id, id, id)
	}
	return []byte(strings.Replace(string(raw), `"preferences": [`, `"preferences": [`+entries, 1))
}

// emptyFan is the fan API's answer for a member with no league.
var emptyFan = []byte(`{"id":"` + goodSWID + `","preferences":[]}`)

// fakeESPN accepts the good cookies and refuses any other. The member's
// list is the fan answer it holds; a league in private is one the public
// cannot read, and a league not in the list is one the member is not in.
type fakeESPN struct {
	reads, lists, publicChecks int
	fan                        []byte
	private                    map[string]bool
	// unanswered is a league whose public check ESPN does not answer.
	unanswered map[string]bool
	// weeks counts the period reads; refuseWeeks refuses their cookies.
	weeks       int
	refuseWeeks bool
}

func (f *fakeESPN) MyLeagues(_ context.Context, c espn.Cookies, season int) ([]espn.MyLeague, error) {
	f.lists++
	if c.SWID != goodSWID {
		return nil, espn.ErrSignedOut
	}
	return espn.ParseMyLeagues(f.fan, season)
}

func (f *fakeESPN) PendingTrades(context.Context, espn.Cookies, string, int) ([]espn.PendingTrade, error) {
	return nil, nil
}

func (f *fakeESPN) listed(id string) bool {
	list, _ := espn.ParseMyLeagues(f.fan, 2026)
	for _, l := range list {
		if l.LeagueID == id {
			return true
		}
	}
	return false
}

func (f *fakeESPN) Read(_ context.Context, id string, _ int, c *espn.Cookies) (espn.FullLeague, error) {
	if c == nil {
		panic("the connect path read a whole league as the public")
	}
	f.reads++
	if c.S2 != goodS2 || !f.listed(id) {
		return espn.FullLeague{}, espn.ErrSignedOut
	}
	return espn.FullLeague{ID: id}, nil
}

func (f *fakeESPN) ReadWeek(_ context.Context, id string, season, period int, c *espn.Cookies) (espn.WeekRead, error) {
	f.weeks++
	if c == nil || c.S2 != goodS2 || f.refuseWeeks || !f.listed(id) {
		return espn.WeekRead{}, espn.ErrSignedOut
	}
	return espn.WeekRead{Season: season, Period: period}, nil
}

func (f *fakeESPN) Public(_ context.Context, id string, _ int) (bool, error) {
	f.publicChecks++
	if f.unanswered[id] {
		return false, espn.ErrUnavailable
	}
	return !f.private[id], nil
}

type memStore struct {
	conn      *hosts.Connection
	refusals  int
	signedOut bool
	puts      int
}

func (m *memStore) put(accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time, proven bool) hosts.Connection {
	m.puts++
	m.conn = &hosts.Connection{AccountID: accountID, Host: host, Status: hosts.StatusConnected, Sealed: sealed, CreatedAt: now, Proven: proven}
	return *m.conn
}

func (m *memStore) PutConsented(_ context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed, now time.Time, proven bool, shown int) (hosts.Connection, error) {
	c := m.put(accountID, host, sealed, now, proven)
	m.conn.ConsentVersion, c.ConsentVersion = shown, shown
	return c, nil
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

func (m *memStore) same(wrapped []byte) bool {
	return m.conn != nil && string(wrapped) == string(m.conn.Sealed.WrappedKey)
}

func (m *memStore) SignedOutAt(_ context.Context, _ uuid.UUID, _ string, wrapped []byte) error {
	if m.same(wrapped) {
		m.signedOut = true
		m.conn.Status = hosts.StatusSignedOut
	}
	return nil
}

func (m *memStore) Proved(_ context.Context, _ uuid.UUID, _ string, wrapped []byte) error {
	if m.same(wrapped) {
		m.conn.Proven = true
	}
	return nil
}

func (m *memStore) Read(context.Context, uuid.UUID, string, time.Time) error { return nil }

type noneFollowed struct{}

func (noneFollowed) FollowedIDs(context.Context, uuid.UUID, string) (map[string]bool, error) {
	return map[string]bool{}, nil
}

type testClock struct{ now time.Time }

func (c *testClock) Now() time.Time { return c.now }

type rig struct {
	s      *Service
	store  *memStore
	client *fakeESPN
	member *Member
	clock  *testClock
	me     uuid.UUID
}

// setup is the service over a member whose one league, agbo, is private.
func setup(t *testing.T) rig {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	vault, err := hosts.NewVault(hosts.OneKey(key))
	if err != nil {
		t.Fatal(err)
	}
	clock := &testClock{now: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)}
	store, client := &memStore{}, &fakeESPN{fan: fanFixture(t), private: map[string]bool{agbo: true}}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	publicity := &Publicity{Client: client, Now: clock.Now}
	member := &Member{Client: client, Public: publicity, Store: store, Vault: vault, Now: clock.Now, Log: log}
	s := &Service{
		Enabled: true, Client: client, Public: publicity, Store: store, Vault: vault, Leagues: member,
		Followed: noneFollowed{}, Now: clock.Now, Log: log,
	}
	return rig{s: s, store: store, client: client, member: member, clock: clock, me: uuid.New()}
}

func call(t *testing.T, h http.HandlerFunc, id uuid.UUID, body any) (int, []byte) {
	t.Helper()
	return callIn(t, context.Background(), h, id, body)
}

// callIn is call with the request under ctx.
func callIn(t *testing.T, ctx context.Context, h http.HandlerFunc, id uuid.UUID, body any) (int, []byte) {
	t.Helper()
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(http.MethodGet, "/", nil)
	} else {
		raw, _ := json.Marshal(body)
		r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
	}
	r = r.WithContext(auth.WithAccount(ctx, auth.Account{ID: id}))
	w := httptest.NewRecorder()
	h(w, r)
	return w.Code, w.Body.Bytes()
}

var goodPair = apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: goodS2, Consent: true}

func connected(t *testing.T, body []byte) apitypes.HostConnected {
	t.Helper()
	var out struct {
		Data apitypes.HostConnected `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("body %s: %v", body, err)
	}
	return out.Data
}

// A member with a private league connects proven: their list read, the
// league the public cannot read read with the cookies, and only the two
// cookies kept, sealed. The answer names the leagues, marked private.
func TestConnectProvesOnAPrivateLeague(t *testing.T) {
	r := setup(t)
	status, body := call(t, r.s.connect, r.me, goodPair)
	if status != http.StatusCreated {
		t.Fatalf("connect: %d %s", status, body)
	}
	out := connected(t, body)
	if len(out.Leagues) != 1 || *out.Leagues[0].Teams != 14 || out.Leagues[0].Public == nil || *out.Leagues[0].Public {
		t.Fatalf("answer %s", body)
	}
	if !out.Connection.Proven || !r.store.conn.Proven || out.Note != nil {
		t.Fatalf("proven %v kept %v note %v", out.Connection.Proven, r.store.conn.Proven, out.Note)
	}
	if strings.Contains(string(body), goodS2) || r.client.lists != 1 || r.client.reads != 1 || r.client.publicChecks != 1 {
		t.Fatalf("answer carries the cookie, or %d lists %d reads %d public checks", r.client.lists, r.client.reads, r.client.publicChecks)
	}
	s2, err := r.s.Vault.OpenSession(r.me.String(), Host, r.store.conn.Sealed)
	if err != nil || s2[keySWID] != goodSWID || s2[keyS2] != goodS2 || len(s2) != 2 {
		t.Fatalf("kept %d values, %v", len(s2), err)
	}
}

// The founder's case: every league ESPN lists is public. The session is
// kept anyway, unproven, and the answer is 200 with the leagues, each
// marked public, and one sentence saying why the session is kept.
func TestConnectKeepsAPublicOnlySessionUnproven(t *testing.T) {
	r := setup(t)
	r.client.fan, r.client.private = fanFixture(t, public, "1001"), map[string]bool{}
	status, body := call(t, r.s.connect, r.me, goodPair)
	if status != http.StatusOK {
		t.Fatalf("all public: %d %s", status, body)
	}
	out := connected(t, body)
	want := "ESPN lists 3 leagues for you this season, all public. We keep your session for the day a private league or a move needs it."
	if out.Note == nil || *out.Note != want {
		t.Fatalf("note %v", out.Note)
	}
	if r.store.conn == nil || r.store.conn.Proven || out.Connection.Proven || r.client.reads != 0 || r.store.refusals != 0 {
		t.Fatalf("kept %v, proven %v, %d reads with cookies, %d refusals", r.store.conn != nil, out.Connection.Proven, r.client.reads, r.store.refusals)
	}
	for _, l := range out.Leagues {
		if l.Public == nil || !*l.Public {
			t.Fatalf("league %s not marked public", l.LeagueId)
		}
	}

	r = setup(t)
	r.client.private = map[string]bool{}
	_, body = call(t, r.s.connect, r.me, goodPair)
	if note := connected(t, body).Note; note == nil || *note != "ESPN lists 1 league for you this season, a public one. We keep your session for the day a private league or a move needs it." {
		t.Fatalf("one public league: %v", note)
	}
}

// An empty list keeps the session unproven, with its own sentence.
func TestConnectKeepsAnEmptyListUnproven(t *testing.T) {
	r := setup(t)
	r.client.fan = emptyFan
	status, body := call(t, r.s.connect, r.me, goodPair)
	out := connected(t, body)
	want := "ESPN lists no football league for your account this season. We keep your session, and your leagues appear here when ESPN lists them."
	if status != http.StatusOK || out.Note == nil || *out.Note != want || len(out.Leagues) != 0 || r.store.conn == nil || r.store.conn.Proven {
		t.Fatalf("empty: %d %s", status, body)
	}
}

// A connect keeps the consent words the page says it showed: version 3
// when it says 3, 2 when it says nothing (a page from before the moves).
func TestConnectKeepsTheShownConsent(t *testing.T) {
	for _, tc := range []struct {
		shown *int
		want  int
	}{{nil, 2}, {ptrInt(3), 3}} {
		r := setup(t)
		in := goodPair
		in.ConsentVersion = tc.shown
		if status, body := call(t, r.s.connect, r.me, in); status >= 300 || r.store.conn == nil || r.store.conn.ConsentVersion != tc.want {
			t.Fatalf("shown %v: %d %s", tc.shown, status, body)
		}
	}
}

func ptrInt(n int) *int { return &n }

// A league whose public check ESPN does not answer is never guessed: it
// carries no public mark, and the sentence counts only what was checked.
func TestConnectNeverGuessesPublic(t *testing.T) {
	r := setup(t)
	r.client.fan, r.client.private = fanFixture(t, public), map[string]bool{}
	r.client.unanswered = map[string]bool{agbo: true}
	status, body := call(t, r.s.connect, r.me, goodPair)
	out := connected(t, body)
	want := "ESPN lists 2 leagues for you this season, and the 1 we checked is public. We keep your session for the day a private league or a move needs it."
	if status != http.StatusOK || out.Note == nil || *out.Note != want {
		t.Fatalf("one unchecked: %d %s", status, body)
	}
	for _, l := range out.Leagues {
		if (l.LeagueId == agbo) != (l.Public == nil) {
			t.Fatalf("league %s public %v", l.LeagueId, l.Public)
		}
	}
	r.client.unanswered[public] = true
	r.clock.now = r.clock.now.Add(2 * time.Hour)
	_, body = call(t, r.s.connect, r.me, goodPair)
	if note := connected(t, body).Note; note == nil || *note != "ESPN lists 2 leagues for you this season. ESPN did not answer whether they are public just now. We keep your session for the day a private league or a move needs it." {
		t.Fatalf("none checked: %v", note)
	}
}

// Cookies ESPN refuses are refused in one sentence and counted; three in
// an hour pause connecting.
func TestConnectRefused(t *testing.T) {
	r := setup(t)
	for range 3 {
		if status, _ := call(t, r.s.connect, r.me, apitypes.ESPNConnectInput{Swid: badSWID, EspnS2: goodS2, Consent: true}); status != http.StatusUnprocessableEntity {
			t.Fatalf("refused cookies: %d", status)
		}
	}
	if status, _ := call(t, r.s.connect, r.me, goodPair); status != http.StatusLocked {
		t.Fatalf("after three refusals: %d", status)
	}
	if r.store.conn != nil {
		t.Fatal("a refused pair was kept")
	}
	r = setup(t)
	if status, _ := call(t, r.s.connect, r.me, apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: "short" + strings.Repeat("A", 40), Consent: true}); status != http.StatusUnprocessableEntity || r.store.conn != nil {
		t.Fatalf("an espn_s2 that ESPN refuses on a private league read: %d", status)
	}
}

// What is not two cookies, or no consent, is named field by field; a
// SWID pasted without its braces is read with them.
func TestConnectChecksTheForm(t *testing.T) {
	r := setup(t)
	status, body := call(t, r.s.connect, r.me, apitypes.ESPNConnectInput{Swid: "nope", EspnS2: "a b", Consent: false})
	if status != http.StatusBadRequest || !strings.Contains(string(body), "swid") || !strings.Contains(string(body), "espn_s2") || !strings.Contains(string(body), "consent") {
		t.Fatalf("form: %d %s", status, body)
	}
	if r.client.lists != 0 {
		t.Fatal("ESPN was read for a form that does not check out")
	}
	if status, body := call(t, r.s.connect, r.me, apitypes.ESPNConnectInput{Swid: strings.Trim(goodSWID, "{}"), EspnS2: goodS2, Consent: true}); status != http.StatusCreated {
		t.Fatalf("a SWID with no braces: %d %s", status, body)
	}
	r.s.Enabled = false
	if status, _ := call(t, r.s.connect, r.me, goodPair); status != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", status)
	}
}

// The league list reads with the kept cookies, public and private, each
// marked; the public check is made once and kept for the hour. Cookies
// ESPN later refuses mark the connection for a reconnect, and disconnect
// deletes them.
func TestLeaguesAndReconnect(t *testing.T) {
	r := setup(t)
	if status, _ := call(t, r.s.leagues, r.me, nil); status != http.StatusNotFound {
		t.Fatalf("not connected: %d", status)
	}
	r.client.fan = fanFixture(t, public)
	call(t, r.s.connect, r.me, goodPair)
	checks := r.client.publicChecks
	status, body := call(t, r.s.leagues, r.me, nil)
	var list struct {
		Data []apitypes.HostLeague `json:"data"`
	}
	if status != http.StatusOK || json.Unmarshal(body, &list) != nil || len(list.Data) != 2 {
		t.Fatalf("leagues: %d %s", status, body)
	}
	marks := map[string]bool{}
	for _, l := range list.Data {
		if l.Public == nil {
			t.Fatalf("league %s unmarked", l.LeagueId)
		}
		marks[l.LeagueId] = *l.Public
	}
	if marks[agbo] || !marks[public] || r.client.publicChecks != checks {
		t.Fatalf("marks %v, %d public checks since connect", marks, r.client.publicChecks-checks)
	}
	r.clock.now = r.clock.now.Add(time.Hour + time.Second)
	call(t, r.s.leagues, r.me, nil)
	if r.client.publicChecks != checks+2 {
		t.Fatalf("an hour on, %d public checks since connect", r.client.publicChecks-checks)
	}

	sealed, _ := Seal(r.s.Vault, r.me, espn.Cookies{SWID: badSWID, S2: goodS2})
	r.store.conn.Sealed = sealed
	if status, _ := call(t, r.s.leagues, r.me, nil); status != http.StatusConflict || !r.store.signedOut {
		t.Fatalf("refused cookies: %d, signed out %v", status, r.store.signedOut)
	}
	if _, err := r.member.Cookies(context.Background(), r.me); !errors.Is(err, ErrReconnect) {
		t.Fatalf("a signed out connection still opens: %v", err)
	}
	req := httptest.NewRequest(http.MethodDelete, "/", nil).WithContext(auth.WithAccount(context.Background(), auth.Account{ID: r.me}))
	w := httptest.NewRecorder()
	hosts.Disconnect(r.s.Store, Host, r.s.Log)(w, req)
	if w.Code != http.StatusOK || r.store.conn != nil {
		t.Fatalf("disconnect: %d", w.Code)
	}
}

// Proof later: a session kept unproven stays so through member reads of
// public leagues, and the first member read of a league the public cannot
// read proves it. A reconnect since the read began is never proved by it.
func TestAPrivateMemberReadProvesTheSession(t *testing.T) {
	r := setup(t)
	r.client.fan, r.client.private = fanFixture(t, public), map[string]bool{}
	call(t, r.s.connect, r.me, goodPair)
	if r.store.conn.Proven {
		t.Fatal("a public-only connect proved the session")
	}
	ctx := context.Background()
	if _, err := r.member.ReadLeague(ctx, r.me, public, 2026); err != nil || r.store.conn.Proven {
		t.Fatalf("a public league read as the member: %v, proven %v", err, r.store.conn.Proven)
	}
	// The commissioner makes agbo private; the public check made at
	// connect is an hour old by the next read.
	r.client.private[agbo] = true
	r.clock.now = r.clock.now.Add(time.Hour + time.Second)
	if _, err := r.member.ReadLeague(ctx, r.me, agbo, 2026); err != nil || !r.store.conn.Proven {
		t.Fatalf("a private league read as the member: %v, proven %v", err, r.store.conn.Proven)
	}
	checks := r.client.publicChecks
	if _, err := r.member.ReadLeague(ctx, r.me, agbo, 2026); err != nil || r.client.publicChecks != checks {
		t.Fatalf("a proven session checked again: %v, %d checks", err, r.client.publicChecks-checks)
	}
}

// The connect path logs the list's size and the checks, never a cookie.
func TestConnectLogsCountsNotCookies(t *testing.T) {
	r := setup(t)
	var buf strings.Builder
	r.s.Log = slog.New(slog.NewTextHandler(&buf, nil))
	r.client.fan, r.client.private = fanFixture(t, public, "1001"), map[string]bool{}
	call(t, r.s.connect, r.me, goodPair)
	out := buf.String()
	for _, want := range []string{"level=INFO", "listed=3", "probed=3", "public=3", "proven=false"} {
		if !strings.Contains(out, want) {
			t.Fatalf("log lacks %q: %s", want, out)
		}
	}
	if strings.Contains(out, goodSWID) || strings.Contains(out, "00000001-0000") || strings.Contains(out, goodS2) {
		t.Fatalf("log carries a cookie: %s", out)
	}
}

// A league the member is not in refuses their working cookies as ESPN
// refuses cookies that no longer work: the member's own list tells the
// two apart, and only the second signs them out.
func TestReadLeagueNotTheirsKeepsTheConnection(t *testing.T) {
	r := setup(t)
	call(t, r.s.connect, r.me, goodPair)
	if _, err := r.member.ReadLeague(context.Background(), r.me, "999", 2026); !errors.Is(err, espn.ErrPrivate) || r.store.signedOut {
		t.Fatalf("a league not theirs: %v, signed out %v", err, r.store.signedOut)
	}
	if _, err := r.member.ReadLeague(context.Background(), r.me, agbo, 2026); err != nil {
		t.Fatalf("their league: %v", err)
	}
}

// ReadWeek reads a period of the league with the member's kept cookies;
// cookies ESPN refuses mark the connection for a reconnect (Lane 93).
func TestReadWeekUsesTheKeptCookies(t *testing.T) {
	r := setup(t)
	call(t, r.s.connect, r.me, goodPair)
	got, err := r.member.ReadWeek(context.Background(), r.me, agbo, 2026, 7)
	if err != nil || got.Period != 7 || r.client.weeks != 1 {
		t.Fatalf("%+v %v, %d week reads", got, err, r.client.weeks)
	}
	r.client.refuseWeeks = true
	if _, err := r.member.ReadWeek(context.Background(), r.me, agbo, 2026, 7); !errors.Is(err, ErrReconnect) || !r.store.signedOut {
		t.Fatalf("refused cookies: %v, signed out %v", err, r.store.signedOut)
	}
}

// A week read of a league the member is not in (left, or removed) is that
// league's refusal: the connection is kept, as ReadLeague keeps it (Lane 93
// review H1).
func TestReadWeekNotTheirsKeepsTheConnection(t *testing.T) {
	r := setup(t)
	call(t, r.s.connect, r.me, goodPair)
	if _, err := r.member.ReadWeek(context.Background(), r.me, "999", 2026, 7); !errors.Is(err, espn.ErrPrivate) || r.store.signedOut {
		t.Fatalf("a league not theirs: %v, signed out %v", err, r.store.signedOut)
	}
	if _, err := r.member.ReadWeek(context.Background(), r.me, agbo, 2026, 7); err != nil {
		t.Fatalf("their league: %v", err)
	}
}
