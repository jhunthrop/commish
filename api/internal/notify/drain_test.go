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

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

// fakeSender records each message and answers the error set for its
// token, nil by default.
type fakeSender struct {
	mu   sync.Mutex
	errs map[string]error
	sent []Message
}

func (f *fakeSender) Send(_ context.Context, m Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return f.errs[m.Token]
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

// device pairs an app device for the member with a push token on it.
func (f outboxFixture) device(kind string, platform Platform, token string) uuid.UUID {
	f.t.Helper()
	hash := make([]byte, 32)
	_, _ = rand.Read(hash)
	var id uuid.UUID
	err := f.pool.QueryRow(context.Background(), `insert into app.devices
		(account_id, name, token_hash, scopes, kind, push_platform, push_token, push_registered_at)
		values ($1, 'A phone', $2, array['session', 'league:write', 'draft:write'], $3, $4, $5, now()) returning id`,
		f.acct, hash, kind, string(platform), token).Scan(&id)
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

// row is the one outbox row's state.
type rowState struct {
	sent, failed bool
	attempts     int
	sendAfter    time.Time
}

func (f outboxFixture) row() rowState {
	f.t.Helper()
	var s rowState
	var sent, failed *time.Time
	if err := f.pool.QueryRow(context.Background(), `select sent_at, failed_at, attempts, send_after from app.notifications`).
		Scan(&sent, &failed, &s.attempts, &s.sendAfter); err != nil {
		f.t.Fatal(err)
	}
	s.sent, s.failed = sent != nil, failed != nil
	return s
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
	iosToken     = "0123456789abcdef0123456789abcdef"
)

// noon is outside the default quiet hours.
var noon = time.Date(2026, 10, 25, 16, 0, 0, 0, time.UTC)

// A due row goes to the device and is sent; a row due later waits; the
// payload carries the kind and the data, never the dedupe key.
func TestDrainSends(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	c := &clock{now: noon}
	f.enqueue(Notification{Kind: KindStarterStatus, Title: "A title", Body: "A body", SendAfter: noon,
		Data: map[string]string{DedupeKey: "k1", "player_id": "p1"}})
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
	if _, leaked := data[DedupeKey]; leaked {
		t.Fatal("the dedupe key rode on the payload")
	}
	var sent int
	if err := f.pool.QueryRow(context.Background(), `select count(*) from app.notifications where sent_at is not null`).Scan(&sent); err != nil || sent != 1 {
		t.Fatalf("sent rows %d %v", sent, err)
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
		if r.sent || !r.failed || r.attempts != attempt+1 || !r.sendAfter.Equal(c.now.Add(wait)) {
			t.Fatalf("attempt %d: %+v", attempt+1, r)
		}
		if got, _ := d.Run(context.Background()); got != (Drained{}) {
			t.Fatalf("claimed inside its backoff: %+v", got)
		}
		c.now = r.sendAfter
	}
	got, err := d.Run(context.Background())
	if err != nil || got.Dead != 1 {
		t.Fatalf("last attempt: %+v %v", got, err)
	}
	c.now = c.now.Add(24 * time.Hour)
	if got, _ := d.Run(context.Background()); got != (Drained{}) {
		t.Fatalf("a dead row was claimed: %+v", got)
	}
	if r := f.row(); r.sent || r.attempts != 3 || len(fcm.sent) != 3 {
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
// left that took it, is dead; a fresh token on another device still
// receives the next row.
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
	if r := f.row(); r.sent || r.attempts != 3 {
		t.Fatalf("row %+v", r)
	}
}

// APNs is not configured until its key is here: an iOS-only row is given
// up and logged, an Android device beside it still receives it.
func TestDrainWithAPNsNotConfigured(t *testing.T) {
	f := newOutbox(t)
	f.device("ios", PlatformAPNS, iosToken)
	c := &clock{now: noon}
	apns, err := NewAPNs(APNsConfig{Topic: "app.trycommish.ios"}, nil, c.Now)
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

// The same dedupe key for the same account and kind is one row.
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
}
