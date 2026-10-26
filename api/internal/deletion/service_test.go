package deletion_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/deletion"
	"github.com/jhunthrop/commish/api/internal/devices"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/lobby"
	"github.com/jhunthrop/commish/api/internal/server"
)

// The fixed clock every test runs on.
var fixedNow = time.Date(2026, 10, 26, 18, 0, 0, 0, time.UTC)

func clock() time.Time { return fixedNow }

const (
	memberEmail  = "Member@Example.invalid"
	memberUser   = "user_member"
	otherUser    = "user_other"
	cookieSecret = "a-test-cookie-password-of-at-least-32-bytes"
)

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// fakeUsers is the sign-in provider: it records each user it was asked
// to delete and fails every call while fail is set.
type fakeUsers struct {
	deleted []string
	fail    error
}

func (f *fakeUsers) DeleteUser(_ context.Context, id string) error {
	if f.fail != nil {
		return f.fail
	}
	f.deleted = append(f.deleted, id)
	return nil
}

// fakeObjects is the bucket, recording the keys deleted.
type fakeObjects struct{ deleted []string }

func (f *fakeObjects) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

// recordingRooms reads the live rooms from the database (lobby.Store)
// and records each Leave instead of replaying the room.
type recordingRooms struct {
	store *lobby.Store
	left  []uuid.UUID
}

func (r *recordingRooms) LiveRoomsOf(ctx context.Context, account uuid.UUID) ([]uuid.UUID, error) {
	return r.store.LiveRoomsOf(ctx, account)
}

func (r *recordingRooms) Leave(_ context.Context, id, _ uuid.UUID) error {
	r.left = append(r.left, id)
	return nil
}

// fakeCookies records whether the cookie was cleared.
type fakeCookies struct{ cleared int }

func (f *fakeCookies) Clear(http.ResponseWriter) { f.cleared++ }

type fixture struct {
	pool    *pgxpool.Pool
	svc     *deletion.Service
	users   *fakeUsers
	objects *fakeObjects
	rooms   *recordingRooms
	cookies *fakeCookies
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	pool := dbtest.Pool(t)
	f := fixture{
		pool: pool, users: &fakeUsers{}, objects: &fakeObjects{},
		rooms: &recordingRooms{store: &lobby.Store{Pool: pool, Now: clock}}, cookies: &fakeCookies{},
	}
	f.svc = &deletion.Service{
		Accounts: &deletion.Store{Pool: pool}, Rooms: f.rooms, Users: f.users, Objects: f.objects,
		Cookies: f.cookies, Now: clock, Log: quietLog(),
	}
	return f
}

func (f fixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", strings.Fields(sql)[0:3], err)
	}
}

func (f fixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (f fixture) account(t *testing.T, workosUser, email, handle string) auth.Account {
	t.Helper()
	store := &auth.Store{Pool: f.pool}
	a, err := store.UpsertAccount(context.Background(), auth.Identity{UserID: workosUser, Email: email, FirstName: "Pat"})
	if err != nil {
		t.Fatal(err)
	}
	if a, err = store.SetHandle(context.Background(), a.ID, handle); err != nil {
		t.Fatal(err)
	}
	return a
}

func hash(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// rooms of the fixture: one complete lobby both members drafted, and one
// drafting now with the member's seat.
var (
	doneRoom = uuid.MustParse("00000000-0000-0000-0000-00000000d001")
	liveRoom = uuid.MustParse("00000000-0000-0000-0000-00000000d002")
	pass     = uuid.MustParse("00000000-0000-0000-0000-00000000a001")
)

// seed gives the member one of everything an account reaches, and the
// other member a seat beside them and a claim on their group pass.
func (f fixture) seed(t *testing.T, member, other auth.Account) {
	t.Helper()
	id := member.ID
	f.exec(t, `insert into app.sessions (account_id, token_hash, workos_session_id, expires_at) values ($1, $2, 'session_m', $3)`,
		id, hash("session"), fixedNow.Add(time.Hour))
	f.exec(t, `insert into app.devices (account_id, name, token_hash, scopes, kind, workos_session_id)
		values ($1, 'Pat''s iPhone', $2, array['session','league:write','draft:write'], 'ios', 'session_d')`, id, hash("device"))
	f.exec(t, `insert into app.device_pair_codes (account_id, code_hash, expires_at, kind) values ($1, $2, $3, 'extension')`,
		id, hash("code"), fixedNow.Add(time.Minute))
	f.exec(t, `insert into app.league_links (id, account_id, host, host_league_id, host_season, roster_id, read_as_member)
		values ('00000000-0000-0000-0000-00000000c001', $1, 'sleeper', '123', 0, 3, false)`, id)
	f.exec(t, `insert into app.league_selections (account_id, link_id) values ($1, '00000000-0000-0000-0000-00000000c001')`, id)
	f.exec(t, `insert into app.league_snapshots (host, host_league_id, host_season, snapshot, read_at, read_as)
		values ('yahoo', '9', 0, '{}', $2, $1), ('sleeper', '123', 0, '{}', $2, '00000000-0000-0000-0000-000000000000')`, id, fixedNow)
	f.exec(t, `insert into app.host_connections (account_id, host, wrapped_key, session_ct, signin_ct, key_version, consented_at, consent_version)
		values ($1, 'ffpc', $2, $3, $3, 1, $4, 1)`, id, make([]byte, 40), make([]byte, 16), fixedNow)
	f.exec(t, `insert into app.sheets (id, account_id, name, format) values ('00000000-0000-0000-0000-00000000e001', $1, 'Mine', 'ppr')`, id)
	f.exec(t, `insert into app.exports (account_id, sheet_id, format, object_key, file_name, bytes, expires_at)
		values ($1, '00000000-0000-0000-0000-00000000e001', 'csv', 'exports/one.csv', 'Mine.csv', 10, $2)`, id, fixedNow.Add(time.Hour))
	f.exec(t, `insert into app.mocks (id, account_id, settings, seed) values ('00000000-0000-0000-0000-00000000f001', $1, '{}', 7)`, id)
	f.exec(t, `insert into app.mock_actions (mock_id, seq, kind) values ('00000000-0000-0000-0000-00000000f001', 1, 'START')`)
	f.seedRooms(t, member, other)
	f.exec(t, `insert into app.group_passes (id, purchaser_id, league_name, season, seats, claim_code, stripe_checkout_session_id)
		values ($1, $2, 'The league', 2026, 10, 'claim-code-0123456789', 'cs_test_1')`, pass, id)
	f.exec(t, `insert into app.entitlements (account_id, product, source, status, season, ends_at, group_pass_id, granted_by)
		values ($1, 'draft_pass', 'group_pass', 'active', 2026, $3, $2, 'claim'), ($4, 'draft_pass', 'group_pass', 'active', 2026, $3, $2, 'claim')`,
		other.ID, pass, fixedNow.Add(24*time.Hour), id)
}

func (f fixture) seedRooms(t *testing.T, member, other auth.Account) {
	t.Helper()
	for _, room := range []struct {
		id     uuid.UUID
		status string
	}{{doneRoom, "complete"}, {liveRoom, "drafting"}} {
		f.exec(t, `insert into app.rooms (id, queue, settings, seed, clock_seconds, status) values ($1, '12_ppr', '{}', 1, 60, $2)`, room.id, room.status)
	}
	f.exec(t, `insert into app.room_seats (room_id, seat, account_id, handle) values ($1, 1, $2, $3), ($1, 2, $4, $5), ($6, 4, $2, $3)`,
		doneRoom, member.ID, *member.Handle, other.ID, *other.Handle, liveRoom)
	f.exec(t, `insert into app.room_actions (room_id, seq, kind, seat, payload) values
		($1, 1, 'SEAT_JOINED', 1, jsonb_build_object('handle', $2::text)),
		($1, 2, 'SEAT_JOINED', 2, jsonb_build_object('handle', $3::text))`, doneRoom, *member.Handle, *other.Handle)
	f.exec(t, `insert into app.lobby_picks (room_id, pick_no, round, seat, player_id, account_id, by_bot, queue, scoring, teams, picked_at)
		values ($1, 1, 1, 1, '4046', $2, false, '12_ppr', 'ppr', 12, $3)`, doneRoom, member.ID, fixedNow)
}

// accountRows counts, in every app table, the rows a column that names
// an account ties to id: account_id, purchaser_id and read_as.
func (f fixture) accountRows(t *testing.T, id uuid.UUID) map[string]int {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `select table_name, column_name from information_schema.columns
		where table_schema = 'app' and column_name in ('account_id', 'purchaser_id', 'read_as')
		  and table_name in (select tablename from pg_tables where schemaname = 'app')
		order by table_name, column_name`)
	if err != nil {
		t.Fatal(err)
	}
	type col struct{ table, column string }
	var cols []col
	for rows.Next() {
		var c col
		if err := rows.Scan(&c.table, &c.column); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	rows.Close()
	out := map[string]int{}
	for _, c := range cols {
		out[c.table+"."+c.column] = f.count(t, `select count(*) from app.`+c.table+` where `+c.column+` = $1`, id)
	}
	return out
}

func deleteRequest(a auth.Account, body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/me/delete", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r.WithContext(auth.WithAccount(r.Context(), a))
}

func route(t *testing.T, svc *deletion.Service) http.HandlerFunc {
	t.Helper()
	for _, rt := range svc.Routes() {
		if rt.Method == http.MethodPost && rt.Path == "/me/delete" && rt.Access == httpx.SignedIn {
			return rt.Handler
		}
	}
	t.Fatal("no POST /me/delete for a signed-in member")
	return nil
}

func serve(t *testing.T, svc *deletion.Service, r *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	route(t, svc)(w, r)
	return w
}

// A member with devices, a followed league, a platform connection, a
// sheet and its export, a mock, a seat in a finished lobby and one live,
// and a group pass another member claimed: the email typed in another
// case deletes every row the account reaches, renames the kept seats,
// leaves the live room, deletes the sign-in user and the export file,
// clears the cookie and answers 204. The other member keeps everything.
func TestDeleteEveryRowAndRenameTheKept(t *testing.T) {
	f := newFixture(t)
	member := f.account(t, memberUser, memberEmail, "pat_drafts")
	other := f.account(t, otherUser, "other@example.invalid", "sam_drafts")
	f.seed(t, member, other)
	otherBefore := f.accountRows(t, other.ID)
	// The check below is only as good as its reach: the seed fills every
	// table it names but the few a later lane added (companions, moves).
	held := 0
	for _, n := range f.accountRows(t, member.ID) {
		if n > 0 {
			held++
		}
	}
	if held < 14 {
		t.Fatalf("the member holds rows in only %d tables before the delete", held)
	}

	w := serve(t, f.svc, deleteRequest(member, `{"email": "  member@EXAMPLE.invalid "}`))
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Fatalf("answer %d %q, want 204 with no body", w.Code, w.Body)
	}
	for table, n := range f.accountRows(t, member.ID) {
		if n != 0 {
			t.Errorf("%s still holds %d rows of the deleted account", table, n)
		}
	}
	if n := f.count(t, `select count(*) from app.accounts where id = $1`, member.ID); n != 0 {
		t.Fatalf("the account row is still there")
	}
	if got := f.accountRows(t, other.ID); !mapsEqual(got, otherBefore) {
		t.Fatalf("the other member's rows changed: %v, were %v", got, otherBefore)
	}
	assertKept(t, f, other)
	if !slices.Equal(f.users.deleted, []string{memberUser}) {
		t.Fatalf("sign-in users deleted %v", f.users.deleted)
	}
	if n := f.count(t, `select count(*) from app.workos_user_deletions`); n != 0 {
		t.Fatalf("%d sign-in users still queued after the provider deleted them", n)
	}
	if !slices.Equal(f.objects.deleted, []string{"exports/one.csv"}) {
		t.Fatalf("export files deleted %v", f.objects.deleted)
	}
	if !slices.Equal(f.rooms.left, []uuid.UUID{liveRoom}) {
		t.Fatalf("live rooms left %v, want the drafting room alone", f.rooms.left)
	}
	if f.cookies.cleared != 1 {
		t.Fatalf("cookie cleared %d times", f.cookies.cleared)
	}
	// The device's token opens nothing: its row is gone.
	if _, _, err := (&devices.Store{Pool: f.pool}).DeviceAccount(context.Background(), hash("device"), fixedNow); !errors.Is(err, auth.ErrNoDevice) {
		t.Fatalf("the device still resolves: %v", err)
	}
}

// assertKept checks the rows kept for the record: the seats under the
// departed word in the seat and its join row, the pick with no account,
// the shared league read, and the group pass with no buyer, still the
// other member's claim.
func assertKept(t *testing.T, f fixture, other auth.Account) {
	t.Helper()
	ctx := context.Background()
	var handle string
	if err := f.pool.QueryRow(ctx, `select handle from app.room_seats where room_id = $1 and seat = 1 and account_id is null`, doneRoom).Scan(&handle); err != nil || handle != deletion.DepartedHandle {
		t.Fatalf("the finished room's seat: %q, %v", handle, err)
	}
	if err := f.pool.QueryRow(ctx, `select payload->>'handle' from app.room_actions where room_id = $1 and seq = 1`, doneRoom).Scan(&handle); err != nil || handle != deletion.DepartedHandle {
		t.Fatalf("the seat's join row: %q, %v", handle, err)
	}
	if err := f.pool.QueryRow(ctx, `select payload->>'handle' from app.room_actions where room_id = $1 and seq = 2`, doneRoom).Scan(&handle); err != nil || handle != *other.Handle {
		t.Fatalf("the other member's join row: %q, %v", handle, err)
	}
	if err := f.pool.QueryRow(ctx, `select handle from app.room_seats where room_id = $1 and seat = 4`, liveRoom).Scan(&handle); err != nil || handle != deletion.DepartedHandle {
		t.Fatalf("the live room's seat: %q, %v", handle, err)
	}
	if n := f.count(t, `select count(*) from app.lobby_picks where room_id = $1 and account_id is null and not by_bot`, doneRoom); n != 1 {
		t.Fatalf("the member's lobby pick: %d kept with no account", n)
	}
	if n := f.count(t, `select count(*) from app.league_snapshots where read_as = '00000000-0000-0000-0000-000000000000'`); n != 1 {
		t.Fatalf("the shared league read: %d", n)
	}
	if n := f.count(t, `select count(*) from app.group_passes where id = $1 and purchaser_id is null`, pass); n != 1 {
		t.Fatalf("the group pass was not kept with no buyer")
	}
	if n := f.count(t, `select count(*) from app.entitlements where group_pass_id = $1 and account_id = $2`, pass, other.ID); n != 1 {
		t.Fatalf("the other member lost their claim")
	}
}

func mapsEqual(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// A provider that fails leaves the account deleted here, the answer 204,
// and the user queued with the failure; the sweep's retry deletes it
// once the provider answers, and drops the row.
func TestProviderFailureIsQueuedAndRetried(t *testing.T) {
	f := newFixture(t)
	member := f.account(t, memberUser, memberEmail, "pat_drafts")
	f.users.fail = errors.New("workos: 503")

	if w := serve(t, f.svc, deleteRequest(member, `{"email": "member@example.invalid"}`)); w.Code != http.StatusNoContent {
		t.Fatalf("answer %d %s", w.Code, w.Body)
	}
	if n := f.count(t, `select count(*) from app.accounts where id = $1`, member.ID); n != 0 {
		t.Fatal("the account was kept when the provider failed")
	}
	var attempts int
	var lastErr string
	if err := f.pool.QueryRow(context.Background(), `select attempts, last_error from app.workos_user_deletions
		where workos_user_id = $1 and former_account_id = $2`, memberUser, member.ID).Scan(&attempts, &lastErr); err != nil {
		t.Fatalf("no queued user: %v", err)
	}
	if attempts != 1 || lastErr != "workos: 503" {
		t.Fatalf("queued with %d attempts, %q", attempts, lastErr)
	}

	got, err := f.svc.Retry(context.Background(), 10)
	if err != nil || got != (deletion.Retried{Failed: 1}) {
		t.Fatalf("retry while failing: %+v, %v", got, err)
	}
	f.users.fail = nil
	got, err = f.svc.Retry(context.Background(), 10)
	if err != nil || got != (deletion.Retried{Deleted: 1}) {
		t.Fatalf("retry: %+v, %v", got, err)
	}
	if !slices.Equal(f.users.deleted, []string{memberUser}) {
		t.Fatalf("sign-in users deleted %v", f.users.deleted)
	}
	if n := f.count(t, `select count(*) from app.workos_user_deletions`); n != 0 {
		t.Fatalf("%d still queued", n)
	}
}

// A confirmation that is not the account's email deletes nothing and
// answers 400 on the email field.
func TestWrongConfirmationDeletesNothing(t *testing.T) {
	f := newFixture(t)
	member := f.account(t, memberUser, memberEmail, "pat_drafts")
	for _, body := range []string{`{"email": "someone@example.invalid"}`, `{"email": ""}`, `{}`, `{"email": "member@example"}`} {
		w := serve(t, f.svc, deleteRequest(member, body))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body)
		}
		if body != `{}` && !strings.Contains(w.Body.String(), deletion.WrongEmail) {
			t.Fatalf("%s: %s", body, w.Body)
		}
	}
	if n := f.count(t, `select count(*) from app.accounts where id = $1`, member.ID); n != 1 {
		t.Fatal("a wrong confirmation deleted the account")
	}
	if len(f.users.deleted) != 0 || f.cookies.cleared != 0 {
		t.Fatalf("a wrong confirmation reached the provider %v or the cookie %d", f.users.deleted, f.cookies.cleared)
	}
}

// A membership that still renews refuses the delete with 409 and its
// sentence, and keeps the account.
func TestRenewingMembershipRefuses(t *testing.T) {
	f := newFixture(t)
	member := f.account(t, memberUser, memberEmail, "pat_drafts")
	f.exec(t, `insert into app.entitlements (account_id, product, source, status, stripe_subscription_id, granted_by, billing_interval)
		values ($1, 'membership', 'subscription', 'active', 'sub_test_1', 'stripe', 'year')`, member.ID)
	w := serve(t, f.svc, deleteRequest(member, `{"email": "member@example.invalid"}`))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), deletion.Renewing) {
		t.Fatalf("answer %d %s", w.Code, w.Body)
	}
	if n := f.count(t, `select count(*) from app.accounts where id = $1`, member.ID); n != 1 {
		t.Fatal("the account was deleted with a renewing membership")
	}
}

// Signed out, the mounted route answers 401 and reaches nothing.
func TestSignedOutIs401(t *testing.T) {
	f := newFixture(t)
	sessions, err := auth.NewSessions(config.Session{CookiePassword: cookieSecret}, 0, &auth.Store{Pool: f.pool}, clock, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	if err := server.Mount(mux, f.svc.Routes(), sessions, nil, clock); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/me/delete", strings.NewReader(`{"email": "member@example.invalid"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("answer %d %s", w.Code, w.Body)
	}
	if len(f.users.deleted) != 0 || len(f.rooms.left) != 0 {
		t.Fatal("a signed-out request reached the provider or a room")
	}
}

func TestConfirmed(t *testing.T) {
	cases := []struct {
		typed, email string
		want         bool
	}{
		{"pat@example.invalid", "pat@example.invalid", true},
		{" PAT@Example.Invalid\t", "pat@example.invalid", true},
		{"", "", false},
		{"pat@example.invalid ", "other@example.invalid", false},
		{"pat", "pat@example.invalid", false},
	}
	for _, c := range cases {
		if got := deletion.Confirmed(c.typed, c.email); got != c.want {
			t.Errorf("Confirmed(%q, %q) = %v", c.typed, c.email, got)
		}
	}
}
