package leaguesync

import (
	"context"
	"errors"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/mfl"
)

func hostFixture(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type fakeESPNTrades struct {
	list []espn.PendingTrade
	err  error
}

func (f fakeESPNTrades) PendingTrades(context.Context, uuid.UUID, string, int) ([]espn.PendingTrade, error) {
	return f.list, f.err
}

type fakeYahooTrades struct {
	list []yahoo.PendingTrade
	team int
}

func (f *fakeYahooTrades) PendingTrades(_ context.Context, _ uuid.UUID, _ int, _ string, team int) ([]yahoo.PendingTrade, error) {
	f.team = team
	return f.list, nil
}

type fakeMFLTrades struct {
	franchise int
	list      []mfl.PendingTrade
	err       error
}

func (f fakeMFLTrades) PendingTrades(context.Context, uuid.UUID, string, int) (int, []mfl.PendingTrade, error) {
	return f.franchise, f.list, f.err
}

// ESPN's queue as the member of team 7 reads it: the offer team 2 made is
// theirs, the member's own offer and the accepted trade are not.
func TestESPNOffers(t *testing.T) {
	list, err := espn.ParsePendingTrades(hostFixture(t, "../espn/testdata/pending-trades-2026.json"), "48153503", 2026)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ESPNOffers{Member: fakeESPNTrades{list: list}}.Offers(context.Background(), uuid.New(), Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026}, 7)
	if err != nil {
		t.Fatal(err)
	}
	expires, proposed := time.UnixMilli(1792392370000).UTC(), time.UnixMilli(1792219571734).UTC()
	want := []Offer{{OfferID: "a1b2c3d4-0000-4000-8000-000000000002", From: 2, Give: []string{"9000102", "9000103"}, Get: []string{"4000002"},
		Drop: []string{}, ProposedAt: &proposed, ExpiresAt: &expires}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	_, err = ESPNOffers{Member: fakeESPNTrades{err: hosts.ErrNotConnected}}.Offers(context.Background(), uuid.New(), Ref{Host: HostESPN}, 7)
	if !errors.Is(err, ErrNotConnected) {
		t.Fatalf("not connected: %v", err)
	}
}

// Yahoo's pending trades for team 1: the one team 2 proposed to it.
func TestYahooOffers(t *testing.T) {
	list, err := yahoo.ParsePendingTrades(hostFixture(t, "../hosts/yahoo/testdata/yahoo-pending-trades.xml"))
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeYahooTrades{list: list}
	got, err := YahooOffers{Member: f}.Offers(context.Background(), uuid.New(), Ref{Host: HostYahoo, LeagueID: "128934"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	proposed := time.Unix(1792219571, 0).UTC()
	want := []Offer{{OfferID: "470.l.128934.pt.1", From: 2, Give: []string{"31002"}, Get: []string{"33001"}, Drop: []string{}, ProposedAt: &proposed}}
	if f.team != 1 || !reflect.DeepEqual(got, want) {
		t.Fatalf("asked for team %d, got %+v, want %+v", f.team, got, want)
	}
}

// MyFantasyLeague's offers to franchise 3, the offering franchise's sides
// turned to the member's; the offer with a draft pick is left out, and a
// session whose franchise is not the attached roster reads nothing.
func TestMFLOffers(t *testing.T) {
	list, err := mfl.DecodePendingTrades(hostFixture(t, "../mfl/testdata/pending-trades-member.json"))
	if err != nil {
		t.Fatal(err)
	}
	ref := Ref{Host: HostMFL, LeagueID: "10010", Season: 2026}
	got, err := MFLOffers{Member: fakeMFLTrades{franchise: 3, list: list}}.Offers(context.Background(), uuid.New(), ref, 3)
	if err != nil {
		t.Fatal(err)
	}
	proposed, expires := time.Unix(1792265989, 0).UTC(), time.Unix(1792868400, 0).UTC()
	want := []Offer{{OfferID: "1002", From: 1, Give: []string{"15757"}, Get: []string{"14802"}, Drop: []string{}, ProposedAt: &proposed, ExpiresAt: &expires}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if _, err := (MFLOffers{Member: fakeMFLTrades{franchise: 4, list: list}}).Offers(context.Background(), uuid.New(), ref, 3); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another franchise: %v", err)
	}
	if _, err := (MFLOffers{Member: fakeMFLTrades{err: mfl.ErrSignedOut}}).Offers(context.Background(), uuid.New(), ref, 3); !errors.Is(err, ErrSignInAgain) {
		t.Fatalf("signed out: %v", err)
	}
}

// memOffers is the capture's store in memory.
type memOffers struct {
	mu    sync.Mutex
	links []Link
	kept  map[uuid.UUID][]Offer
	puts  int
}

func (m *memOffers) LinksOf(context.Context, Ref) ([]Link, error) { return m.links, nil }

func (m *memOffers) PutOffers(_ context.Context, l Link, offers []Offer, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.kept == nil {
		m.kept = map[uuid.UUID][]Offer{}
	}
	m.kept[l.ID] = offers
	m.puts++
	return nil
}

// flaky fails until told not to, counting its reads.
type flaky struct {
	mu    sync.Mutex
	fail  bool
	reads int
}

func (f *flaky) Offers(context.Context, uuid.UUID, Ref, int) ([]Offer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads++
	if f.fail {
		return nil, ErrUnavailable
	}
	return []Offer{{OfferID: "b", From: 2}, {OfferID: "a", From: 3}}, nil
}

// A failed read is remembered: the next landed reads inside OfferFailFor
// do not try the host and keep nothing, so the last good read stands; past
// it the host is read again. A good read is not repeated inside OfferGap.
func TestOfferCaptureHoldsAFailure(t *testing.T) {
	now := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	ref := Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026}
	store := &memOffers{links: []Link{{ID: uuid.New(), AccountID: uuid.New(), Ref: ref, RosterID: 7}}}
	reader := &flaky{fail: true}
	c := &OfferCapture{Readers: map[string]OfferReader{HostESPN: reader}, Store: store, Now: func() time.Time { return now }, Log: quietLog()}
	ctx := context.Background()
	c.Capture(ctx, ref)
	now = now.Add(OfferGap + time.Second)
	c.Capture(ctx, ref)
	if reader.reads != 1 || store.puts != 0 {
		t.Fatalf("%d reads and %d kept inside the failure's hold, want 1 and 0", reader.reads, store.puts)
	}
	reader.fail = false
	now = now.Add(OfferFailFor)
	c.Capture(ctx, ref)
	if reader.reads != 2 || store.puts != 1 {
		t.Fatalf("%d reads and %d kept past the hold, want 2 and 1", reader.reads, store.puts)
	}
	if got := store.kept[store.links[0].ID]; len(got) != 2 || got[0].OfferID != "a" {
		t.Fatalf("kept %+v, want both offers in id order", got)
	}
	c.Capture(ctx, ref)
	if reader.reads != 2 {
		t.Fatalf("a good read repeated inside OfferGap: %d reads", reader.reads)
	}
	// A host with no reader is never read.
	c.Capture(ctx, Ref{Host: HostSleeper, LeagueID: "1"})
	if reader.reads != 2 {
		t.Fatalf("a host without a reader was read")
	}
}

// Landed captures behind the read, once a league at a time.
func TestOfferCaptureLanded(t *testing.T) {
	ref := Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026}
	store := &memOffers{links: []Link{{ID: uuid.New(), AccountID: uuid.New(), Ref: ref, RosterID: 7}}}
	reader := &flaky{}
	c := &OfferCapture{Readers: map[string]OfferReader{HostESPN: reader}, Store: store, Now: time.Now, Log: quietLog()}
	c.Landed(Snapshot{Ref: ref})
	deadline := time.Now().Add(5 * time.Second)
	for {
		store.mu.Lock()
		puts := store.puts
		store.mu.Unlock()
		if puts == 1 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the landed read's offers were never kept")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Each read replaces the link's offers in one transaction: an offer the
// next read does not find is retired, an empty read retires them all, and
// the archive gains a row only when a read differs from the one before.
// Another account reads none of them.
func TestPutOffersRetiresThePreviousClaim(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_bob", Email: "bob@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	link, err := store.Save(ctx, Link{AccountID: alice.ID, Ref: Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026, As: alice.ID}, RosterID: 7}, true)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	expires := at.Add(48 * time.Hour)
	a := Offer{OfferID: "a", From: 2, Give: []string{"1"}, Get: []string{"2"}, Drop: []string{}, ExpiresAt: &expires}
	b := Offer{OfferID: "b", From: 3, Give: []string{"3", "4"}, Get: []string{"5"}, Drop: []string{"6"}}
	archive := func() int {
		var n int
		if err := pool.QueryRow(ctx, `select count(*) from app.host_offer_reads where link_id = $1`, link.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	ids := func(account uuid.UUID) []string {
		held, err := store.Offers(ctx, account, link.ID)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, h := range held {
			out = append(out, h.OfferID)
		}
		return out
	}
	steps := []struct {
		offers  []Offer
		want    []string
		archive int
	}{
		{[]Offer{a, b}, []string{"a", "b"}, 1},
		{[]Offer{a, b}, []string{"a", "b"}, 1},
		{[]Offer{b}, []string{"b"}, 2},
		{[]Offer{}, []string{}, 3},
		{[]Offer{}, []string{}, 3},
	}
	for i, s := range steps {
		if err := store.PutOffers(ctx, link, s.offers, at.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatal(err)
		}
		if got := ids(alice.ID); !reflect.DeepEqual(got, s.want) || archive() != s.archive {
			t.Fatalf("step %d: offers %v and %d archived, want %v and %d", i, got, archive(), s.want, s.archive)
		}
	}
	if err := store.PutOffers(ctx, link, []Offer{b}, at.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	held, err := store.Offers(ctx, alice.ID, link.ID)
	if err != nil || len(held) != 1 || !reflect.DeepEqual(held[0].Drop, []string{"6"}) || !held[0].ReadAt.Equal(at.Add(time.Hour)) {
		t.Fatalf("held %+v %v", held, err)
	}
	if got := ids(bob.ID); len(got) != 0 {
		t.Fatalf("another account read %v", got)
	}
}
