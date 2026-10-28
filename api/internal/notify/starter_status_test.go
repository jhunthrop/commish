package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// designated is a capture's designations by player, from codes.
func designated(codes map[string]string, notes map[string]string, at time.Time) map[string]boards.Designation {
	out := map[string]boards.Designation{}
	for id, code := range codes {
		out[id] = boards.Designation{Code: code, Note: notes[id], AsOf: at}
	}
	return out
}

var (
	olderAt = time.Date(2026, 10, 25, 14, 0, 0, 0, time.UTC)
	newerAt = time.Date(2026, 10, 25, 15, 0, 0, 0, time.UTC)
)

// fixturePair is a capture diff with one player of each kind of move.
func fixturePair() boards.DesignationPair {
	return boards.DesignationPair{
		Older: designated(map[string]string{
			"cleared": "Q", "ir": "O", "activated": "IR", "season_out": "O", "doubtful": "Q", "same": "Q", "upgraded": "O",
		}, map[string]string{"season_out": "Out for the season (knee)"}, olderAt),
		Newer: designated(map[string]string{
			"out": "O", "ir": "IR", "doubtful": "D", "same": "Q", "newly_q": "Q", "upgraded": "Q",
		}, nil, newerAt),
		OlderAt: olderAt, NewerAt: newerAt,
	}
}

// The changes a member hears about, and nothing else: newly out,
// doubtful, cleared of a week's designation, on injured reserve, back
// from a season-long list. A newly questionable player, an unchanged one
// and an out upgraded to questionable say nothing.
func TestChangesFromACaptureDiff(t *testing.T) {
	got := Changes(fixturePair())
	want := []Change{
		{PlayerID: "activated", Change: ChangeActivated, From: boards.StatusInjuredReserve},
		{PlayerID: "cleared", Change: ChangeCleared, From: boards.StatusQuestionable},
		{PlayerID: "doubtful", Change: ChangeDoubtful, From: boards.StatusQuestionable, To: boards.StatusDoubtful},
		{PlayerID: "ir", Change: ChangeInjuredReserve, From: boards.StatusOut, To: boards.StatusInjuredReserve},
		{PlayerID: "out", Change: ChangeOut, To: boards.StatusOut},
		{PlayerID: "season_out", Change: ChangeActivated, From: boards.StatusOut},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("changes\n got %+v\nwant %+v", got, want)
	}
}

// fakeDesignations answers its pairs whose newer capture is after since,
// as the store does.
type fakeDesignations struct{ pairs []boards.DesignationPair }

func (f fakeDesignations) DesignationPairs(_ context.Context, since time.Time) ([]boards.DesignationPair, error) {
	var out []boards.DesignationPair
	for _, p := range f.pairs {
		if p.NewerAt.After(since) {
			out = append(out, p)
		}
	}
	return out, nil
}

func pairsOf(p ...boards.DesignationPair) fakeDesignations { return fakeDesignations{pairs: p} }

// fakeLineups starts each account's own lineup; an account it does not
// know fails its read.
type fakeLineups map[uuid.UUID][]leaguesync.LeagueStarters

func (f fakeLineups) Starters(_ context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error) {
	got, ok := f[accountID]
	if !ok {
		return nil, errors.New("the league read failed")
	}
	return got, nil
}

// One change, one account whose followed league starts him: one row with
// the player's words and the deep link; the producer run again adds
// nothing; an account with no device, and a pair hours old, add nothing.
func TestStarterStatusProducer(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	league := uuid.MustParse("00000000-0000-0000-0000-00000000aa01")
	other := uuid.New() // starts the same player, no device registered
	lineups := fakeLineups{
		f.acct: {{LinkID: league, LeagueName: "Dynasty Degenerates", Players: []leaguesync.StartingPlayer{
			{BoardID: "out", Name: "Ja'Marr Chase", Position: "WR", Team: "CIN"},
			{BoardID: "steady", Name: "A Steady Back", Position: "RB", Team: "BUF"},
		}}},
		other: {{LinkID: uuid.New(), LeagueName: "Other", Players: []leaguesync.StartingPlayer{{BoardID: "out", Name: "Ja'Marr Chase"}}}},
	}
	c := &clock{now: newerAt.Add(20 * time.Minute)}
	p := &StarterStatus{Designations: pairsOf(fixturePair()), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}

	got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow))
	if err != nil || got.Changes != 6 || got.Queued != 1 || got.NewerAt == nil || !got.NewerAt.Equal(newerAt) {
		t.Fatalf("produced %+v %v", got, err)
	}
	var title, body string
	var raw []byte
	var sendAfter time.Time
	if err := f.pool.QueryRow(context.Background(), `select title, body, data, send_after from app.notifications where account_id = $1 and kind = 'starter_status'`,
		f.acct).Scan(&title, &body, &raw, &sendAfter); err != nil {
		t.Fatal(err)
	}
	var data map[string]string
	_ = json.Unmarshal(raw, &data)
	if title != "Ja'Marr Chase is out" || body != "He starts in your Dynasty Degenerates lineup. Set a replacement before his game." {
		t.Fatalf("words %q %q", title, body)
	}
	if data["player_id"] != "out" || data["change"] != "out" || data["league_id"] != league.String() ||
		data["path"] != "/league/"+league.String()+"/start?player=out" || !sendAfter.Equal(c.Now()) {
		t.Fatalf("data %v, send after %v", data, sendAfter)
	}

	again, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow))
	if err != nil || again.Queued != 0 {
		t.Fatalf("again %+v %v", again, err)
	}
	var rows int
	if err := f.pool.QueryRow(context.Background(), `select count(*) from app.notifications`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows %d %v", rows, err)
	}

	if stale, err := p.Produce(context.Background(), newerAt); err != nil || stale.NewerAt != nil || stale.Queued != 0 {
		t.Fatalf("nothing after since: %+v %v", stale, err)
	}
}

// A change during quiet hours waits for their end; an account with the
// kind switched off gets nothing.
func TestStarterStatusQuietAndSwitchedOff(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	lineups := fakeLineups{f.acct: {{LinkID: uuid.New(), LeagueName: "L", Players: []leaguesync.StartingPlayer{{BoardID: "out", Name: "A Receiver"}}}}}
	late := mustAt(t, "America/New_York", "2026-10-25 23:40")
	pair := fixturePair()
	pair.NewerAt = late.Add(-10 * time.Minute)
	c := &clock{now: late}
	p := &StarterStatus{Designations: pairsOf(pair), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	if got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow)); err != nil || got.Queued != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	if r := f.row(); !r.sendAfter.Equal(mustAt(t, "America/New_York", "2026-10-26 08:00")) {
		t.Fatalf("send after %v", r.sendAfter)
	}

	off := DefaultPreferences()
	off.Off = []Kind{KindStarterStatus}
	if err := f.store.PutPreferences(context.Background(), f.acct, off); err != nil {
		t.Fatal(err)
	}
	pair.NewerAt = pair.NewerAt.Add(time.Minute) // a new capture, a new key
	p.Designations = pairsOf(pair)
	if got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow)); err != nil || got.Queued != 0 {
		t.Fatalf("switched off: %+v %v", got, err)
	}
}

// A run that never happened is caught up by the next: three captures, the
// call after the second skipped, the call after the third queues both
// changes, in order, and the newer gives up the older (review H2, M4). An
// account whose lineups fail is counted, not lost silently (review L3).
func TestStarterStatusCatchesUp(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	league := uuid.New()
	missing := uuid.New()
	if _, err := f.pool.Exec(context.Background(), `insert into app.accounts (id, workos_user_id, email) values ($1, 'user_missing', 'm@example.invalid')`, missing); err != nil {
		t.Fatal(err)
	}
	hash := make([]byte, 32)
	hash[0] = 7
	if _, err := f.pool.Exec(context.Background(), `insert into app.devices (account_id, name, token_hash, scopes, kind, push_platform, push_token, push_registered_at)
		values ($1, 'A phone', $2, array['session'], 'ios', 'fcm', 'fcm-token-missing-000000000000', now())`, missing, hash); err != nil {
		t.Fatal(err)
	}
	lineups := fakeLineups{f.acct: {{LinkID: league, LeagueName: "L", Players: []leaguesync.StartingPlayer{{BoardID: "p1", Name: "A Receiver"}}}}}
	first, second, third := newerAt.Add(-2*time.Hour), newerAt.Add(-time.Hour), newerAt
	ab := boards.DesignationPair{Older: designated(map[string]string{}, nil, first), Newer: designated(map[string]string{"p1": "O"}, nil, second),
		OlderAt: first, NewerAt: second}
	bc := boards.DesignationPair{Older: ab.Newer, Newer: designated(map[string]string{}, nil, third), OlderAt: second, NewerAt: third}
	c := &clock{now: third.Add(5 * time.Minute)}
	p := &StarterStatus{Designations: pairsOf(ab, bc), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow))
	if err != nil || got.Pairs != 2 || got.Changes != 2 || got.Queued != 2 || got.Skipped != 1 {
		t.Fatalf("caught up %+v %v", got, err)
	}
	rows := f.rows()
	given := map[string]bool{}
	for _, r := range rows {
		given[r.key] = r.failed
	}
	outKey := fmt.Sprintf("p1:out:%d", second.Unix())
	clearedKey := fmt.Sprintf("p1:cleared:%d", third.Unix())
	if len(rows) != 2 || !given[outKey] || given[clearedKey] {
		t.Fatalf("the older change was not given up for the newer: %+v", rows)
	}
	if again, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow)); err != nil || again.Queued != 0 {
		t.Fatalf("again %+v %v", again, err)
	}
}

// The words for every change, and for a starter in several lineups.
func TestStarterWords(t *testing.T) {
	title, body := starterWords(ChangeActivated, "A Back", "L", 1)
	if title != "A Back is activated" || body != "He starts in your L lineup. He is off his list and can play again." {
		t.Fatalf("%q %q", title, body)
	}
	if _, body := starterWords(ChangeCleared, "", "L", 3); body != "He starts in 3 of your lineups. He no longer carries an injury designation." {
		t.Fatalf("%q", body)
	}
	for _, c := range []StatusChange{ChangeOut, ChangeDoubtful, ChangeCleared, ChangeInjuredReserve, ChangeActivated} {
		if starterHeadline[c] == "" || starterLine[c] == "" {
			t.Fatalf("%s has no words", c)
		}
	}
}

// A league whose kept read is too old is counted and none of its starters
// is pushed; a fresh league beside it still is (re-review N15).
func TestStarterStatusSkipsStaleLeagues(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	lineups := fakeLineups{f.acct: {
		{LinkID: uuid.New(), LeagueName: "Stale", Stale: true},
		{LinkID: uuid.New(), LeagueName: "Fresh", Players: []leaguesync.StartingPlayer{{BoardID: "doubtful", Name: "A Back"}}},
	}}
	c := &clock{now: newerAt.Add(20 * time.Minute)}
	p := &StarterStatus{Designations: pairsOf(fixturePair()), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow))
	if err != nil || got.StaleLeagues != 1 || got.Queued != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	stale := fakeLineups{f.acct: {{LinkID: uuid.New(), LeagueName: "Stale", Stale: true,
		Players: []leaguesync.StartingPlayer{{BoardID: "out", Name: "Ja'Marr Chase"}}}}}
	p.Lineups = stale
	if got, err := p.Produce(context.Background(), c.Now().Add(-FirstRunWindow)); err != nil || got.Queued != 0 || got.StaleLeagues != 1 {
		t.Fatalf("a stale league's starter was pushed: %+v %v", got, err)
	}
}
