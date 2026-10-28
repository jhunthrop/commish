package leaguesync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

// connectHost keeps a connection row for the account and host, sealed
// under a throwaway key: the store keeps offers only for a connected host.
func connectHost(t *testing.T, pool *pgxpool.Pool, accountID uuid.UUID, host string) {
	t.Helper()
	vault, err := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := vault.Seal(accountID.String(), host, hosts.Session{"session": "test"}, hosts.SignIn{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&hosts.Store{Pool: pool}).Put(context.Background(), accountID, host, sealed, time.Now()); err != nil {
		t.Fatal(err)
	}
}

// offerCounts is the link's current offers and its archived reads, and
// how many of those reads are the empty read a retire appends.
func offerCounts(t *testing.T, pool *pgxpool.Pool, link uuid.UUID) (current, archived, empties int) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `select
		(select count(*) from app.host_offers where link_id = $1),
		(select count(*) from app.host_offer_reads where link_id = $1),
		(select count(*) from app.host_offer_reads where link_id = $1 and offers = '[]'::jsonb)`, link).
		Scan(&current, &archived, &empties)
	if err != nil {
		t.Fatal(err)
	}
	return current, archived, empties
}

// A disconnect retires the offers of every link the member has on that
// host in its own transaction, and a detach retires its link's: each
// claim leaves at once, the archive records the retire, another host's
// link keeps its offers, and a read still in flight afterwards keeps
// nothing (Lane 285, B278).
func TestDisconnectAndDetachRetireOffers(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	save := func(ref Ref) Link {
		ref.As = alice.ID
		l, err := store.Save(ctx, Link{AccountID: alice.ID, Ref: ref, RosterID: 3}, true)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	espnA := save(Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026})
	espnB := save(Ref{Host: HostESPN, LeagueID: "48153504", Season: 2026})
	mflLink := save(Ref{Host: HostMFL, LeagueID: "10010", Season: 2026})
	connectHost(t, pool, alice.ID, HostESPN)
	connectHost(t, pool, alice.ID, HostMFL)
	offer := []Offer{{OfferID: "a", From: 2, Give: []string{"1"}, Get: []string{"2"}}}
	at := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	for _, l := range []Link{espnA, espnB, mflLink} {
		if err := store.PutOffers(ctx, l, offer, at); err != nil {
			t.Fatal(err)
		}
	}

	conns := &hosts.Store{Pool: pool, OnDelete: RetireHostOffers}
	if err := conns.Delete(ctx, alice.ID, HostESPN); err != nil {
		t.Fatal(err)
	}
	for _, l := range []Link{espnA, espnB} {
		if cur, arch, empty := offerCounts(t, pool, l.ID); cur != 0 || arch != 2 || empty != 1 {
			t.Fatalf("espn link after the disconnect: %d current, %d archived, %d retires; want 0, 2, 1", cur, arch, empty)
		}
	}
	if cur, arch, _ := offerCounts(t, pool, mflLink.ID); cur != 1 || arch != 1 {
		t.Fatalf("the other host's link: %d current, %d archived; want 1 and 1", cur, arch)
	}
	if err := store.PutOffers(ctx, espnA, offer, at.Add(time.Minute)); !errors.Is(err, ErrOffersNotKept) {
		t.Fatalf("a read after the disconnect: %v, want ErrOffersNotKept", err)
	}
	if cur, _, _ := offerCounts(t, pool, espnA.ID); cur != 0 {
		t.Fatalf("a read after the disconnect kept %d offers", cur)
	}

	if err := store.Detach(ctx, alice.ID, mflLink.ID); err != nil {
		t.Fatal(err)
	}
	if cur, arch, empty := offerCounts(t, pool, mflLink.ID); cur != 0 || arch != 2 || empty != 1 {
		t.Fatalf("the detached link: %d current, %d archived, %d retires; want 0, 2, 1", cur, arch, empty)
	}
	if err := store.PutOffers(ctx, mflLink, offer, at.Add(time.Minute)); !errors.Is(err, ErrOffersNotKept) {
		t.Fatalf("a read after the detach: %v, want ErrOffersNotKept", err)
	}
	// A restored link answers nothing until its next good read.
	if _, err := store.Restore(ctx, alice.ID, mflLink.ID, true); err != nil {
		t.Fatal(err)
	}
	if held, err := store.Offers(ctx, alice.ID, mflLink.ID); err != nil || len(held) != 0 {
		t.Fatalf("the restored link answered %+v %v", held, err)
	}
	// A disconnect of a host the member never connected is still refused,
	// and a link with no offers archives no retire.
	if err := conns.Delete(ctx, alice.ID, HostESPN); !errors.Is(err, hosts.ErrNotConnected) {
		t.Fatalf("a second disconnect: %v, want ErrNotConnected", err)
	}
	if err := conns.Delete(ctx, alice.ID, HostMFL); err != nil {
		t.Fatal(err)
	}
	if _, arch, empty := offerCounts(t, pool, mflLink.ID); arch != 2 || empty != 1 {
		t.Fatalf("a retire with nothing held archived again: %d archived, %d retires", arch, empty)
	}
}

// The sweep's prune deletes the archived reads older than its cut and
// keeps the rest.
func TestPruneOfferReads(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	link, err := store.Save(ctx, Link{AccountID: alice.ID, Ref: Ref{Host: HostESPN, LeagueID: "48153503", Season: 2026, As: alice.ID}, RosterID: 7}, true)
	if err != nil {
		t.Fatal(err)
	}
	connectHost(t, pool, alice.ID, HostESPN)
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	reads := []struct {
		at     time.Time
		offers []Offer
	}{
		{now.Add(-OfferReadsKept - 24*time.Hour), []Offer{{OfferID: "a", From: 2, Give: []string{"1"}}}},
		{now.Add(-OfferReadsKept - time.Hour), []Offer{}},
		{now.Add(-OfferReadsKept + time.Hour), []Offer{{OfferID: "b", From: 2, Give: []string{"1"}}}},
	}
	for _, r := range reads {
		if err := store.PutOffers(ctx, link, r.offers, r.at); err != nil {
			t.Fatal(err)
		}
	}
	n, err := store.PruneOfferReads(ctx, now.Add(-OfferReadsKept))
	if err != nil || n != 2 {
		t.Fatalf("pruned %d (%v), want 2", n, err)
	}
	if _, arch, _ := offerCounts(t, pool, link.ID); arch != 1 {
		t.Fatalf("%d archived reads left, want the one inside the window", arch)
	}
}

// The hold map never grows past maxOfferHolds: holds already over go
// first, and with none over, the one ending soonest; a link already held
// is renewed in place.
func TestOfferHoldsAreBounded(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	c := &OfferCapture{Now: func() time.Time { return now }, Log: quietLog()}
	first := uuid.New()
	c.hold(first, time.Minute)
	for i := 1; i < maxOfferHolds; i++ {
		c.hold(uuid.New(), OfferFailFor)
	}
	if len(c.until) != maxOfferHolds {
		t.Fatalf("%d holds, want %d", len(c.until), maxOfferHolds)
	}
	c.hold(first, OfferFailFor)
	if len(c.until) != maxOfferHolds {
		t.Fatalf("renewing a held link grew the map to %d", len(c.until))
	}
	// None is over: the soonest-ending goes.
	soonest := uuid.New()
	delete(c.until, first)
	c.hold(soonest, time.Second)
	extra := uuid.New()
	c.hold(extra, OfferFailFor)
	if len(c.until) != maxOfferHolds {
		t.Fatalf("%d holds past the bound, want %d", len(c.until), maxOfferHolds)
	}
	if _, ok := c.until[soonest]; ok {
		t.Fatal("the soonest-ending hold was kept over a new one")
	}
	if c.due(extra) {
		t.Fatal("the new hold was not kept")
	}
	// Past the holds, every one over is forgotten at once.
	now = now.Add(OfferFailFor)
	c.hold(uuid.New(), OfferGap)
	if len(c.until) != 1 {
		t.Fatalf("%d holds after every hold was over, want 1", len(c.until))
	}
}
