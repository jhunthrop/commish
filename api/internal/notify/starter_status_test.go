package notify

import (
	"context"
	"encoding/json"
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

type fakeDesignations struct{ pair boards.DesignationPair }

func (f fakeDesignations) DesignationPair(context.Context) (boards.DesignationPair, bool, error) {
	return f.pair, !f.pair.NewerAt.IsZero(), nil
}

// fakeLineups starts the same lineup for every account it knows.
type fakeLineups map[uuid.UUID][]leaguesync.LeagueStarters

func (f fakeLineups) Starters(_ context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error) {
	return f[accountID], nil
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
	p := &StarterStatus{Designations: fakeDesignations{pair: fixturePair()}, Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}

	got, err := p.Produce(context.Background())
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
		data["path"] != "/league/"+league.String()+"/start?player=out" || !sendAfter.Equal(c.now) {
		t.Fatalf("data %v, send after %v", data, sendAfter)
	}

	again, err := p.Produce(context.Background())
	if err != nil || again.Queued != 0 {
		t.Fatalf("again %+v %v", again, err)
	}
	var rows int
	if err := f.pool.QueryRow(context.Background(), `select count(*) from app.notifications`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows %d %v", rows, err)
	}

	c.now = newerAt.Add(DefaultMaxChangeAge + time.Minute)
	if stale, err := p.Produce(context.Background()); err != nil || stale.NewerAt != nil || stale.Queued != 0 {
		t.Fatalf("an old pair: %+v %v", stale, err)
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
	p := &StarterStatus{Designations: fakeDesignations{pair: pair}, Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	if got, err := p.Produce(context.Background()); err != nil || got.Queued != 1 {
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
	p.Designations = fakeDesignations{pair: pair}
	if got, err := p.Produce(context.Background()); err != nil || got.Queued != 0 {
		t.Fatalf("switched off: %+v %v", got, err)
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
