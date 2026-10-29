package notify

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// manyAccounts makes n accounts, each with one push device paired at
// paired, and answers their ids in id order (the walk's order).
func manyAccounts(t *testing.T, f outboxFixture, n int, paired time.Time) []uuid.UUID {
	t.Helper()
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `insert into app.accounts (workos_user_id, email)
		select 'user_many_' || i, 'many' || i || '@example.invalid' from generate_series(1, $1::int) i`, n); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `insert into app.devices
		(account_id, name, token_hash, scopes, kind, push_platform, push_token, push_registered_at, created_at)
		select id, 'A phone', sha256(convert_to(id::text, 'UTF8')), array['session'], 'ios', 'fcm',
			'fcm-token-' || replace(id::text, '-', ''), $1, $1
		from app.accounts where workos_user_id like 'user_many_%'`, paired); err != nil {
		t.Fatal(err)
	}
	rows, err := f.pool.Query(ctx, `select id from app.accounts where workos_user_id like 'user_many_%' order by id`)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil || len(ids) != n {
		t.Fatalf("%d accounts (%v), want %d", len(ids), err, n)
	}
	return ids
}

// walkedLineups starts a bench of unchanged players for every account,
// and the players in starts for the accounts it names; onRead, when set,
// runs before each read with the read's number (from 1).
type walkedLineups struct {
	mu     sync.Mutex
	starts map[uuid.UUID][]string
	reads  int
	onRead func(n int)
}

func (w *walkedLineups) Starters(ctx context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error) {
	w.mu.Lock()
	w.reads++
	n := w.reads
	w.mu.Unlock()
	if w.onRead != nil {
		w.onRead(n)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	players := []leaguesync.StartingPlayer{{BoardID: "steady_qb", Name: "A Steady Passer"}, {BoardID: "steady_rb", Name: "A Steady Back"}}
	for _, id := range w.starts[accountID] {
		players = append(players, leaguesync.StartingPlayer{BoardID: id, Name: "Player " + id})
	}
	return []leaguesync.LeagueStarters{{LinkID: uuid.New(), LeagueName: "L", Players: players}}, nil
}

func (w *walkedLineups) readCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.reads
}

// countingQueue counts the preference reads, the per-account work past
// the lineup.
type countingQueue struct {
	*Store
	mu    sync.Mutex
	prefs int
}

func (q *countingQueue) Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error) {
	q.mu.Lock()
	q.prefs++
	q.mu.Unlock()
	return q.Store.Preferences(ctx, accountID)
}

// statusPair is a pair in which each of codes' players takes its code.
func statusPair(older, newer time.Time, before, after map[string]string) boards.DesignationPair {
	return boards.DesignationPair{Older: designated(before, nil, older), Newer: designated(after, nil, newer), OlderAt: older, NewerAt: newer}
}

// Three thousand push accounts and two changed players: one run walks
// every account, reads preferences and writes only for the three that
// start a changed player, finishes and moves the mark (Lane 285, B275).
func TestStarterStatusWalksThousandsInOnePass(t *testing.T) {
	f := newOutbox(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	ids := manyAccounts(t, f, 3000, now.Add(-time.Hour))
	lineups := &walkedLineups{starts: map[uuid.UUID][]string{
		ids[10]: {"p1"}, ids[1500]: {"p1", "p2"}, ids[2999]: {"p2"},
	}}
	queue := &countingQueue{Store: f.store}
	c := &clock{now: now}
	at := now.Add(-20 * time.Minute)
	producer := &StarterStatus{
		Designations: pairsOf(statusPair(at.Add(-time.Hour), at, map[string]string{"p2": "Q"}, map[string]string{"p1": "O", "p2": "D"})),
		Lineups:      lineups, Queue: queue, Now: c.Now, Log: quiet(),
	}
	cu := &CatchUp{Marks: f.store, Captures: fixedCaptures{at}, StarterStatus: producer, Now: c.Now, Log: quiet()}
	start := time.Now()
	got, ran, err := cu.Run(ctx)
	if err != nil || !ran || !got.Done || got.Accounts != 3000 || got.Queued != 4 || got.Changes != 2 {
		t.Fatalf("%+v ran %v: %v", got, ran, err)
	}
	if elapsed := time.Since(start); elapsed > catchUpBudgetForTests {
		t.Fatalf("the walk took %v, past %v", elapsed, catchUpBudgetForTests)
	}
	if lineups.readCount() != 3000 || queue.prefs != 3 {
		t.Fatalf("%d lineup reads and %d preference reads, want 3000 and 3", lineups.readCount(), queue.prefs)
	}
	mark, err := f.store.MarkOf(ctx, markStarterStatus)
	if err != nil || !mark.DoneThrough.Equal(at) || mark.Resuming() {
		t.Fatalf("mark %+v %v", mark, err)
	}
}

// catchUpBudgetForTests is the job's catch-up budget (cmd/api's
// catchUpBudget, 20 s), which the one-pass walk must fit.
const catchUpBudgetForTests = 20 * time.Second

// A run cut mid-walk keeps the last account it finished and the window it
// paired; the next run walks only the accounts after it over that window
// (a capture landed since is the run after's), finishes and moves the mark
// to the window's end; the run after takes the new capture for everyone.
func TestStarterStatusResumesACutWalk(t *testing.T) {
	f := newOutbox(t)
	now := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	const n, cutAt = 50, 20
	ids := manyAccounts(t, f, n, now.Add(-time.Hour))
	starts := map[uuid.UUID][]string{}
	for _, id := range ids {
		starts[id] = []string{"p1"}
	}
	lineups := &walkedLineups{starts: starts}
	c := &clock{now: now}
	t1, t2 := now.Add(-30*time.Minute), now.Add(-10*time.Minute)
	out := statusPair(t1.Add(-time.Hour), t1, map[string]string{}, map[string]string{"p1": "O"})
	cleared := statusPair(t1, t2, map[string]string{"p1": "Q"}, map[string]string{})
	producer := &StarterStatus{Designations: pairsOf(out), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	run := func(ctx context.Context, newest time.Time) (Produced, error) {
		t.Helper()
		cu := &CatchUp{Marks: f.store, Captures: fixedCaptures{newest}, StarterStatus: producer, Now: c.Now, Log: quiet()}
		got, ran, err := cu.Run(ctx)
		if !ran {
			t.Fatal("the run did not run")
		}
		return got, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	lineups.onRead = func(read int) {
		if read == cutAt {
			cancel()
		}
	}
	got, err := run(ctx, t1)
	if !errors.Is(err, context.Canceled) || got.Accounts != cutAt-1 || got.Queued != cutAt-1 {
		t.Fatalf("the cut run %+v %v", got, err)
	}
	mark, err := f.store.MarkOf(context.Background(), markStarterStatus)
	if err != nil || !mark.DoneThrough.IsZero() || mark.ResumeAfter != ids[cutAt-2] || !mark.ResumeThrough.Equal(t1) {
		t.Fatalf("after the cut: %+v %v, want resume after %v through %v", mark, err, ids[cutAt-2], t1)
	}

	// A capture lands before the resume: the resume keeps to its window.
	lineups.onRead = nil
	readsBefore := lineups.readCount()
	c.set(now.Add(time.Minute))
	producer.Designations = pairsOf(out, cleared)
	got, err = run(context.Background(), t2)
	if err != nil || !got.Done || got.Accounts != n-(cutAt-1) || got.Queued != n-(cutAt-1) || got.Pairs != 1 {
		t.Fatalf("the resume %+v %v", got, err)
	}
	if reads := lineups.readCount() - readsBefore; reads != n-(cutAt-1) {
		t.Fatalf("the resume read %d lineups, want only the %d after the cut", reads, n-(cutAt-1))
	}
	mark, err = f.store.MarkOf(context.Background(), markStarterStatus)
	if err != nil || !mark.DoneThrough.Equal(t1) || mark.Resuming() {
		t.Fatalf("after the resume: %+v %v", mark, err)
	}
	var outs int
	if err := f.pool.QueryRow(context.Background(), `select count(distinct account_id) from app.notifications
		where data->>'change' = 'out'`).Scan(&outs); err != nil || outs != n {
		t.Fatalf("%d accounts told he is out (%v), want all %d", outs, err, n)
	}

	c.set(now.Add(2 * time.Minute))
	got, err = run(context.Background(), t2)
	if err != nil || !got.Done || got.Accounts != n || got.Queued != n {
		t.Fatalf("the run after %+v %v", got, err)
	}
	if mark, err := f.store.MarkOf(context.Background(), markStarterStatus); err != nil || !mark.DoneThrough.Equal(t2) {
		t.Fatalf("after the run after: %+v %v", mark, err)
	}
}

// A pair read cut at its bound moves the mark only to the newest capture
// it read, never to the newest capture stored, says so on one warning
// line with the counts, and the next run pairs the rest (re-review L-e).
func TestCatchUpStopsAtTheNewestPairedCapture(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	now := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	at := func(i int) time.Time { return now.Add(time.Duration(i-10) * time.Minute) }
	var pairs []boards.DesignationPair
	for i := 1; i <= 4; i++ {
		pairs = append(pairs, statusPair(at(i-1), at(i), map[string]string{}, map[string]string{}))
	}
	var logged bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logged, nil))
	c := &clock{now: now}
	producer := &StarterStatus{Designations: fakeDesignations{pairs: pairs, bound: 2}, Lineups: fakeLineups{}, Queue: f.store, Now: c.Now, Log: log}
	cu := &CatchUp{Marks: f.store, Captures: fixedCaptures{at(4)}, StarterStatus: producer, Now: c.Now, Log: log}
	if err := f.store.Finish(context.Background(), markStarterStatus, at(0), at(0)); err != nil {
		t.Fatal(err)
	}
	got, _, err := cu.Run(context.Background())
	if err != nil || !got.Cut || got.Pairs != 2 {
		t.Fatalf("%+v %v", got, err)
	}
	if mark, _ := f.store.MarkOf(context.Background(), markStarterStatus); !mark.DoneThrough.Equal(at(2)) {
		t.Fatalf("the mark went to %v past the newest paired capture %v", mark.DoneThrough, at(2))
	}
	line := logged.String()
	if strings.Count(line, "reached its bound") != 1 || !strings.Contains(line, "read=2") || !strings.Contains(line, "left=2") {
		t.Fatalf("the cut's warning: %s", line)
	}
	c.set(now.Add(time.Minute))
	got, _, err = cu.Run(context.Background())
	if err != nil || got.Cut || got.Pairs != 2 {
		t.Fatalf("the next run %+v %v", got, err)
	}
	if mark, _ := f.store.MarkOf(context.Background(), markStarterStatus); !mark.DoneThrough.Equal(at(4)) {
		t.Fatalf("the mark after the rest: %v", mark.DoneThrough)
	}
}

// A resume is recorded only with an account and a window.
func TestHoldNeedsAnAccountAndAWindow(t *testing.T) {
	f := newOutbox(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	if err := f.store.Hold(ctx, markStarterStatus, now, uuid.Nil, now); err == nil {
		t.Fatal("a resume with no account was kept")
	}
	if err := f.store.Hold(ctx, markStarterStatus, now, uuid.New(), time.Time{}); err == nil {
		t.Fatal("a resume with no window was kept")
	}
}
