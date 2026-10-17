package hostmoves

import (
	"context"
	"crypto/sha256"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The allow list, a token kept once, the answer bounded, and the list the
// member's own, newest first, the last 20.
func TestStore(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	acct, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_moves", Email: "moves@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_moves_other", Email: "other@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	var link uuid.UUID
	if err := pool.QueryRow(ctx, `insert into app.league_links (account_id, host, host_league_id, host_season, roster_id, read_as_member)
		values ($1, 'espn', '1081607624', 2026, 3, true) returning id`, acct.ID).Scan(&link); err != nil {
		t.Fatal(err)
	}
	s := &Store{Pool: pool}

	if ok, err := s.Allowed(ctx, acct.ID, "espn", "lineup"); err != nil || ok {
		t.Fatalf("allowed before the row: %v %v", ok, err)
	}
	if _, err := pool.Exec(ctx, `insert into app.host_write_accounts (account_id, host, kind) values ($1, 'espn', 'lineup')`, acct.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.Allowed(ctx, acct.ID, "espn", "lineup"); err != nil || !ok {
		t.Fatalf("allowed: %v %v", ok, err)
	}
	if ok, _ := s.Allowed(ctx, other.ID, "espn", "lineup"); ok {
		t.Fatal("another account allowed")
	}

	record := func(n int) Record {
		sum := sha256.Sum256([]byte("token " + strconv.Itoa(n)))
		return Record{AccountID: acct.ID, LinkID: link, Host: "espn", HostLeagueID: "1081607624", Season: 2026, Kind: "lineup", Week: 7,
			Digest: sum[:], Plan: []byte(`{"sentence":"Start A over B at RB, on ESPN now.","items":[]}`), Body: []byte(`{"type":"ROSTER"}`)}
	}
	id, err := s.Begin(ctx, record(0))
	if err != nil {
		t.Fatal(err)
	}
	if used, err := s.Used(ctx, acct.ID, record(0).Digest); err != nil || !used {
		t.Fatalf("used: %v %v", used, err)
	}
	if _, err := s.Begin(ctx, record(0)); !errors.Is(err, ErrUsed) {
		t.Fatalf("a token twice: %v", err)
	}
	if err := s.Answered(ctx, acct.ID, id, Answer{Outcome: OutcomeRefused, HostStatus: 409, HostReason: "TRAN_LINEUP_LOCKED",
		HostWords: "Lineup transaction could not be completed, A is locked\x00", ReadBack: readNotRead, Member: "absent"}, time.Now()); err != nil {
		t.Fatalf("answered: %v", err)
	}
	for i := 1; i <= ListMax+2; i++ {
		if _, err := s.Begin(ctx, record(i)); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.List(ctx, acct.ID, link)
	if err != nil || len(list) != ListMax {
		t.Fatalf("list %d: %v", len(list), err)
	}
	if list[0].Outcome != OutcomeSending || list[0].Sentence != "Start A over B at RB, on ESPN now." || list[0].Week != 7 {
		t.Fatalf("newest %+v", list[0])
	}
	if theirs, _ := s.List(ctx, other.ID, link); len(theirs) != 0 {
		t.Fatalf("another account read %d moves", len(theirs))
	}
	var words string
	if err := pool.QueryRow(ctx, `select host_words from app.host_moves where id = $1`, id).Scan(&words); err != nil || !strings.HasPrefix(words, "Lineup") {
		t.Fatalf("kept words %q: %v", words, err)
	}

	// A claim: its own allow-list row (the lineup's does not allow it), and
	// a pending claim keeps when ESPN's queue runs it.
	if ok, err := s.Allowed(ctx, acct.ID, "espn", "claim"); err != nil || ok {
		t.Fatalf("an account allowed only the lineup is allowed a claim: %v %v", ok, err)
	}
	if _, err := pool.Exec(ctx, `insert into app.host_write_accounts (account_id, host, kind) values ($1, 'espn', 'claim')`, acct.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.Allowed(ctx, acct.ID, "espn", "claim"); err != nil || !ok {
		t.Fatalf("claim allowed: %v %v", ok, err)
	}
	claim := record(100)
	claim.Kind, claim.Plan = "claim", []byte(`{"sentence":"Add A, drop B, bid $0.","add":"1","waiver":true}`)
	cid, err := s.Begin(ctx, claim)
	if err != nil {
		t.Fatal(err)
	}
	runs := time.UnixMilli(1792134000000).UTC()
	if err := s.Answered(ctx, acct.ID, cid, Answer{Outcome: OutcomePending, HostStatus: 200, TransactionID: "7c1a2f60",
		ReadBack: readMatched, Member: "absent", ProcessAt: &runs}, time.Now()); err != nil {
		t.Fatalf("claim answered: %v", err)
	}
	var kind string
	var at time.Time
	if err := pool.QueryRow(ctx, `select kind, host_process_at from app.host_moves where id = $1`, cid).Scan(&kind, &at); err != nil ||
		kind != "claim" || !at.Equal(runs) {
		t.Fatalf("kept claim %q %v: %v", kind, at, err)
	}
	if _, err := pool.Exec(ctx, `insert into app.host_write_accounts (account_id, host, kind) values ($1, 'espn', 'trade')`, other.ID); err == nil {
		t.Fatal("a kind with no write path was allowed")
	}

	// MyFantasyLeague: a lineup alone, on the allow list and in the proof.
	if _, err := pool.Exec(ctx, `insert into app.host_write_accounts (account_id, host, kind) values ($1, 'mfl', 'lineup')`, acct.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.Allowed(ctx, acct.ID, "mfl", "lineup"); err != nil || !ok {
		t.Fatalf("mfl lineup allowed: %v %v", ok, err)
	}
	if _, err := pool.Exec(ctx, `insert into app.host_write_accounts (account_id, host, kind) values ($1, 'mfl', 'claim')`, acct.ID); err == nil {
		t.Fatal("a MyFantasyLeague claim was allowed")
	}
	mflMove := record(200)
	mflMove.Host, mflMove.HostLeagueID, mflMove.Body = "mfl", "10010", []byte(`{"TYPE":"lineup","L":"10010","W":"7"}`)
	if _, err := s.Begin(ctx, mflMove); err != nil {
		t.Fatalf("an mfl lineup: %v", err)
	}
	mflClaim := record(201)
	mflClaim.Host, mflClaim.Kind = "mfl", "claim"
	if _, err := s.Begin(ctx, mflClaim); err == nil {
		t.Fatal("an mfl claim was kept")
	}
}
