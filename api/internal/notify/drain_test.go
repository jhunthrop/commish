package notify

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = t
}

// fakeSender records each message and answers the error set for its
// token, nil by default; before, when set, runs first.
type fakeSender struct {
	mu     sync.Mutex
	errs   map[string]error
	sent   []Message
	before func()
}

func (f *fakeSender) Send(_ context.Context, m Message) error {
	if f.before != nil {
		f.before()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return f.errs[m.Token]
}

func (f *fakeSender) tokens() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.sent))
	for i, m := range f.sent {
		out[i] = m.Token
	}
	return out
}

// outboxFixture is a migrated app schema with one member.
type outboxFixture struct {
	t     *testing.T
	pool  *pgxpool.Pool
	store *Store
	acct  uuid.UUID
}

func newOutbox(t *testing.T) outboxFixture {
	t.Helper()
	pool := dbtest.Pool(t)
	a, err := (&auth.Store{Pool: pool}).UpsertAccount(context.Background(), auth.Identity{UserID: "user_push", Email: "push@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	return outboxFixture{t: t, pool: pool, store: &Store{Pool: pool}, acct: a.ID}
}

// device pairs an app device for the member with a push token on it,
// last used at used (the zero time leaves it never used, paired now).
func (f outboxFixture) device(kind string, platform Platform, token string) uuid.UUID {
	return f.deviceUsed(kind, platform, token, time.Time{})
}

func (f outboxFixture) deviceUsed(kind string, platform Platform, token string, used time.Time) uuid.UUID {
	f.t.Helper()
	hash := make([]byte, 32)
	_, _ = rand.Read(hash)
	var last any
	if !used.IsZero() {
		last = used
	}
	var id uuid.UUID
	err := f.pool.QueryRow(context.Background(), `insert into app.devices
		(account_id, name, token_hash, scopes, kind, push_platform, push_token, push_registered_at, last_used_at, created_at)
		values ($1, 'A phone', $2, array['session', 'league:write', 'draft:write'], $3, $4, $5, now(), $6, coalesce($6, now())) returning id`,
		f.acct, hash, kind, string(platform), token, last).Scan(&id)
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f outboxFixture) enqueue(n Notification) {
	f.t.Helper()
	if n.AccountID == uuid.Nil {
		n.AccountID = f.acct
	}
	if _, err := f.store.Enqueue(context.Background(), []Notification{n}); err != nil {
		f.t.Fatal(err)
	}
}

// rowState is one outbox row's state.
type rowState struct {
	sent, failed bool
	attempts     int
	sendAfter    time.Time
	device       *uuid.UUID
	key          string
}

func (f outboxFixture) rows() []rowState {
	f.t.Helper()
	got, err := f.pool.Query(context.Background(), `select sent_at is not null, failed_at is not null, attempts, send_after, device_id,
		coalesce(data ->> 'key', '') from app.notifications order by created_at, device_id nulls first`)
	if err != nil {
		f.t.Fatal(err)
	}
	defer got.Close()
	var out []rowState
	for got.Next() {
		var s rowState
		if err := got.Scan(&s.sent, &s.failed, &s.attempts, &s.sendAfter, &s.device, &s.key); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func (f outboxFixture) row() rowState {
	f.t.Helper()
	rows := f.rows()
	if len(rows) != 1 {
		f.t.Fatalf("%d rows, want one", len(rows))
	}
	return rows[0]
}

func (f outboxFixture) token(id uuid.UUID) *string {
	f.t.Helper()
	var tok *string
	if err := f.pool.QueryRow(context.Background(), `select push_token from app.devices where id = $1`, id).Scan(&tok); err != nil {
		f.t.Fatal(err)
	}
	return tok
}

func (f outboxFixture) drainer(c *clock, senders map[Platform]Sender) *Drainer {
	return &Drainer{Outbox: f.store, Senders: senders, Now: c.Now, Log: quiet(), MaxAttempts: 3}
}

const (
	androidToken = "fcm-token-android-0000000000000000"
	tabletToken  = "fcm-token-tablet-00000000000000000"
	iosToken     = "0123456789abcdef0123456789abcdef"
)

// noon is outside the default quiet hours.
var noon = time.Date(2026, 10, 25, 16, 0, 0, 0, time.UTC)

// A due row goes to the device and is sent; a row due later waits; the
// payload carries the kind and the data, never the outbox's own fields.
func TestDrainSends(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "A title", Body: "A body", SendAfter: noon,
		Data: map[string]string{DedupeKey: "k1", TopicKey: "player:p1", TopicAtKey: "1", "player_id": "p1"}})
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "Later", Body: "Later", SendAfter: noon.Add(time.Hour),
		Data: map[string]string{DedupeKey: "k2"}})
	fcm := &fakeSender{}
	got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Sent != 1 || len(fcm.sent) != 1 {
		t.Fatalf("drained %+v, sent %d", got, len(fcm.sent))
	}
	m := fcm.sent[0]
	data := payload(m)
	if m.Token != androidToken || m.Title != "A title" || data["player_id"] != "p1" || data["kind"] != "starter_status" {
		t.Fatalf("message %+v", m)
	}
	for _, own := range []string{DedupeKey, TopicKey, TopicAtKey} {
		if _, leaked := data[own]; leaked {
			t.Fatalf("%s rode on the payload", own)
		}
	}
}

// A send that fails in a way worth retrying waits a doubling backoff and
// goes again; after its last attempt the row is dead and never claimed.
func TestDrainRetriesWithBackoffThenGivesUp(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	fcm := &fakeSender{errs: map[string]error{androidToken: errors.New("fcm answered 503")}}
	d := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm})

	for attempt, wait := range []time.Duration{time.Minute, 2 * time.Minute} {
		got, err := d.Run(context.Background())
		if err != nil || got.Retried != 1 {
			t.Fatalf("attempt %d: %+v %v", attempt+1, got, err)
		}
		r := f.row()
		if r.sent || !r.failed || r.attempts != attempt+1 || !r.sendAfter.Equal(c.Now().Add(wait)) {
			t.Fatalf("attempt %d: %+v", attempt+1, r)
		}
		if got, _ := d.Run(context.Background()); got != (Drained{}) {
			t.Fatalf("claimed inside its backoff: %+v", got)
		}
		c.set(r.sendAfter)
	}
	got, err := d.Run(context.Background())
	if err != nil || got.Dead != 1 {
		t.Fatalf("last attempt: %+v %v", got, err)
	}
	c.set(c.Now().Add(24 * time.Hour))
	if got, _ := d.Run(context.Background()); got != (Drained{}) {
		t.Fatalf("a dead row was claimed: %+v", got)
	}
	if r := f.row(); r.sent || len(fcm.sent) != 3 {
		t.Fatalf("dead row %+v, %d sends", r, len(fcm.sent))
	}
}

// A retry that would land in quiet hours waits for their end.
func TestDrainRetryRespectsQuietHours(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	late := mustAt(t, "America/New_York", "2026-10-25 22:59")
	c := &clock{now: late}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: late})
	fcm := &fakeSender{errs: map[string]error{androidToken: errors.New("timeout")}}
	if _, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if r := f.row(); !r.sendAfter.Equal(mustAt(t, "America/New_York", "2026-10-26 08:00")) {
		t.Fatalf("retry at %v", r.sendAfter.In(late.Location()))
	}
}

// A dead token's registration is removed and the row, with no device
// left that took it, is dead.
func TestDrainRemovesDeadTokens(t *testing.T) {
	f := newOutbox(t)
	gone := f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	fcm := &fakeSender{errs: map[string]error{androidToken: ErrDeadToken}}
	got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background())
	if err != nil || got.Dead != 1 || got.DroppedTokens != 1 {
		t.Fatalf("drained %+v %v", got, err)
	}
	if tok := f.token(gone); tok != nil {
		t.Fatalf("the dead token stayed: %s", *tok)
	}
	if r := f.row(); r.sent || !r.failed {
		t.Fatalf("row %+v", r)
	}
}

// APNs is not configured until its key is here: an iOS-only row is given
// up, an Android device beside it still receives it.
func TestDrainWithAPNsNotConfigured(t *testing.T) {
	f := newOutbox(t)
	f.device("ios", PlatformAPNS, iosToken)
	c := &clock{now: noon}
	apns, err := NewAPNs(APNsConfig{Topic: "app.trycommish.ios"}, nil, f.store, c.Now)
	if err != nil {
		t.Fatal(err)
	}
	fcm := &fakeSender{}
	d := f.drainer(c, map[Platform]Sender{PlatformAPNS: apns, PlatformFCM: fcm})
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "ios"}})
	if got, err := d.Run(context.Background()); err != nil || got.Dead != 1 {
		t.Fatalf("ios only: %+v %v", got, err)
	}

	f.device("android", PlatformFCM, androidToken)
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "both"}})
	if got, err := d.Run(context.Background()); err != nil || got.Sent != 1 || len(fcm.sent) != 1 {
		t.Fatalf("ios and android: %+v %v", got, err)
	}
}

// A kind switched off after its row was queued is not sent.
func TestDrainHonorsTheSwitch(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	off := DefaultPreferences()
	off.Off = []Kind{KindStarterStatus}
	if err := f.store.PutPreferences(context.Background(), f.acct, off); err != nil {
		t.Fatal(err)
	}
	fcm := &fakeSender{}
	if got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background()); err != nil || got.Dead != 1 || len(fcm.sent) != 0 {
		t.Fatalf("switched off: %+v %v, %d sent", got, err, len(fcm.sent))
	}
}

// A device unused past the session's life gets nothing: a phone given
// away stops receiving the account's pushes when its token stops opening
// the account (security review M1).
func TestDrainSkipsLapsedDevices(t *testing.T) {
	f := newOutbox(t)
	f.deviceUsed("android", PlatformFCM, androidToken, noon.Add(-auth.SessionTTL-time.Hour))
	f.deviceUsed("android", PlatformFCM, tabletToken, noon.Add(-time.Hour))
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	fcm := &fakeSender{}
	if got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background()); err != nil || got.Sent != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	if sent := fcm.tokens(); len(sent) != 1 || sent[0] != tabletToken {
		t.Fatalf("sent to %v", sent)
	}
	accounts, _, err := f.store.PushAccounts(context.Background(), KindStarterStatus, noon.Add(-auth.SessionTTL))
	if err != nil || len(accounts) != 1 {
		t.Fatalf("push accounts %v %v", accounts, err)
	}
}

// Two devices, one takes the row and one fails worth a retry: the row is
// sent and a child row retries the second device alone; the next drain
// sends only there, and draining again adds no second child (review M1).
// With neither taking it the whole row retries.
func TestDrainFansOutAFailedDevice(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	tablet := f.device("android", PlatformFCM, tabletToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "k"}})
	fcm := &fakeSender{errs: map[string]error{tabletToken: errors.New("fcm answered 503")}}
	d := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm})
	if got, err := d.Run(context.Background()); err != nil || got.Sent != 1 {
		t.Fatalf("first drain %+v %v", got, err)
	}
	rows := f.rows()
	if len(rows) != 2 || !rows[0].sent || rows[1].sent || rows[1].device == nil || *rows[1].device != tablet ||
		rows[1].key != "k:"+tablet.String() || rows[1].attempts != 1 || !rows[1].sendAfter.Equal(noon.Add(time.Minute)) {
		t.Fatalf("rows %+v", rows)
	}

	fcm.errs = nil
	c.set(noon.Add(time.Minute))
	if got, err := d.Run(context.Background()); err != nil || got.Sent != 1 {
		t.Fatalf("child drain %+v %v", got, err)
	}
	if sent := fcm.tokens(); len(sent) != 3 || sent[2] != tabletToken {
		t.Fatalf("sends %v", sent)
	}

	f2 := newOutbox(t)
	f2.device("android", PlatformFCM, androidToken)
	f2.device("android", PlatformFCM, tabletToken)
	f2.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	both := &fakeSender{errs: map[string]error{androidToken: errors.New("503"), tabletToken: errors.New("503")}}
	c.set(noon)
	if got, err := f2.drainer(c, map[Platform]Sender{PlatformFCM: both}).Run(context.Background()); err != nil || got.Retried != 1 {
		t.Fatalf("nobody took it: %+v %v", got, err)
	}
	if rows := f2.rows(); len(rows) != 1 || rows[0].sent {
		t.Fatalf("rows %+v", rows)
	}
}

// The same dedupe key for the same account and kind is one row; a row
// with no send_after is refused.
func TestEnqueueDedupes(t *testing.T) {
	f := newOutbox(t)
	rows := []Notification{
		{AccountID: f.acct, Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "same"}},
		{AccountID: f.acct, Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "same"}},
		{AccountID: f.acct, Kind: KindWeekReads, Title: "T", Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: "same"}},
	}
	n, err := f.store.Enqueue(context.Background(), rows)
	if err != nil || n != 2 {
		t.Fatalf("inserted %d %v", n, err)
	}
	if n, err := f.store.Enqueue(context.Background(), rows); err != nil || n != 0 {
		t.Fatalf("again inserted %d %v", n, err)
	}
	if _, err := f.store.Enqueue(context.Background(), []Notification{{AccountID: f.acct, Kind: KindWeekReads, Title: "T", Body: "B"}}); !errors.Is(err, ErrNoSendAfter) {
		t.Fatalf("no send_after: %v", err)
	}
}

// A newer row on a topic gives up the older unsent one, and an older row
// queued after a newer gives itself up; released together, only the
// latest goes (review M4).
func TestEnqueueSupersedesByTopic(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	mk := func(key, title, at string) Notification {
		return Notification{AccountID: f.acct, Kind: KindStarterStatus, Title: title, Body: "B", SendAfter: noon,
			Data: map[string]string{DedupeKey: key, TopicKey: "player:p1", TopicAtKey: at}}
	}
	if _, err := f.store.Enqueue(context.Background(), []Notification{mk("out", "is out", "100"), mk("cleared", "is cleared", "200")}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Enqueue(context.Background(), []Notification{mk("doubtful", "is doubtful", "150")}); err != nil {
		t.Fatal(err)
	}
	fcm := &fakeSender{}
	c := &clock{now: noon}
	got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background())
	if err != nil || got.Sent != 1 || len(fcm.sent) != 1 || fcm.sent[0].Title != "is cleared" {
		t.Fatalf("%+v %v, sent %+v", got, err, fcm.sent)
	}
}

// A row already given up is never written again by a newer one on its
// topic (re-review N8), and a row sent with children on a topic with a
// given-up row beside it completes: the locks are taken in one order.
func TestSupersedeSkipsGivenUpRows(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	f.device("android", PlatformFCM, tabletToken)
	ctx := context.Background()
	mk := func(key, at string) Notification {
		return Notification{AccountID: f.acct, Kind: KindStarterStatus, Title: key, Body: "B", SendAfter: noon,
			Data: map[string]string{DedupeKey: key, TopicKey: "player:p1", TopicAtKey: at}}
	}
	failedAt := func(key string) *time.Time {
		t.Helper()
		var at *time.Time
		if err := f.pool.QueryRow(ctx, `select failed_at from app.notifications where data ->> 'key' = $1`, key).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	if _, err := f.store.Enqueue(ctx, []Notification{mk("a", "100"), mk("b", "200")}); err != nil {
		t.Fatal(err)
	}
	first := failedAt("a")
	if first == nil || failedAt("b") != nil {
		t.Fatal("the newer row did not give up the older")
	}
	if _, err := f.pool.Exec(ctx, `update app.notifications set failed_at = failed_at - interval '1 hour' where data ->> 'key' = 'a'`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Enqueue(ctx, []Notification{mk("c", "300")}); err != nil {
		t.Fatal(err)
	}
	if again := failedAt("a"); again == nil || !again.Equal(first.Add(-time.Hour)) {
		t.Fatalf("a given-up row was written again: %v", again)
	}
	if failedAt("b") == nil || failedAt("c") != nil {
		t.Fatal("the newest row did not give up the one before it")
	}
	fcm := &fakeSender{errs: map[string]error{tabletToken: errors.New("503")}}
	c := &clock{now: noon}
	if got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(ctx); err != nil || got.Sent != 1 {
		t.Fatalf("sent with children beside given-up rows: %+v %v", got, err)
	}
}

// Two runs claiming at once get disjoint rows, the whole due set between
// them (review M9).
func TestConcurrentClaimsAreDisjoint(t *testing.T) {
	f := newOutbox(t)
	var rows []Notification
	for i := range 50 {
		rows = append(rows, Notification{AccountID: f.acct, Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon,
			Data: map[string]string{DedupeKey: uuid.NewString(), "n": string(rune('a' + i%26))}})
	}
	if _, err := f.store.Enqueue(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	got := make([][]Notification, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got[i], errs[i] = f.store.Claim(context.Background(), noon, DefaultLease, 25, DefaultMaxAttempts)
		}()
	}
	wg.Wait()
	seen := map[uuid.UUID]bool{}
	for i := range 2 {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		for _, n := range got[i] {
			if seen[n.ID] {
				t.Fatalf("row %s claimed twice", n.ID)
			}
			seen[n.ID] = true
		}
	}
	if len(seen) != 50 {
		t.Fatalf("claimed %d of 50", len(seen))
	}
}

// A run that crashed leaves its claim to the lease: nothing claims the
// row before the lease ends, the next claim after it takes the row with
// its second attempt, and the crashed run's late mark no longer holds
// (review M9, L2).
func TestACrashedRunsLeaseExpires(t *testing.T) {
	f := newOutbox(t)
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "T", Body: "B", SendAfter: noon})
	first, err := f.store.Claim(context.Background(), noon, DefaultLease, 10, DefaultMaxAttempts)
	if err != nil || len(first) != 1 {
		t.Fatalf("first claim %v %v", first, err)
	}
	if got, _ := f.store.Claim(context.Background(), noon.Add(DefaultLease-time.Second), DefaultLease, 10, DefaultMaxAttempts); len(got) != 0 {
		t.Fatalf("claimed inside the lease: %v", got)
	}
	second, err := f.store.Claim(context.Background(), noon.Add(DefaultLease), DefaultLease, 10, DefaultMaxAttempts)
	if err != nil || len(second) != 1 || second[0].Attempts != 2 {
		t.Fatalf("after the lease %+v %v", second, err)
	}
	if held, err := f.store.MarkDead(context.Background(), first[0], noon); err != nil || held {
		t.Fatalf("the crashed run's mark held: %v %v", held, err)
	}
	if held, err := f.store.MarkSent(context.Background(), second[0], noon.Add(DefaultLease)); err != nil || !held {
		t.Fatalf("the live claim's mark: %v %v", held, err)
	}
}

// A run past its send window releases the rows it claimed and did not
// try, their attempt not counted (review M3).
func TestDrainReleasesUntriedRows(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	for _, key := range []string{"a", "b", "c"} {
		f.enqueue(Notification{Kind: KindStarterStatus, Title: key, Body: "B", SendAfter: noon, Data: map[string]string{DedupeKey: key}})
	}
	// The first send takes so long the lease's send window closes.
	fcm := &fakeSender{}
	fcm.before = func() { c.set(noon.Add(DefaultLease)) }
	got, err := f.drainer(c, map[Platform]Sender{PlatformFCM: fcm}).Run(context.Background())
	if err != nil || got.Sent != 1 || got.Released != 2 {
		t.Fatalf("drained %+v %v", got, err)
	}
	var untried int
	if err := f.pool.QueryRow(context.Background(), `select count(*) from app.notifications where sent_at is null and attempts = 0`).Scan(&untried); err != nil || untried != 2 {
		t.Fatalf("released %d %v", untried, err)
	}
}
