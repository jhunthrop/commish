package yahoo

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The collection's open offers: the one offered to team 1 and the one
// team 1 offered, each with its legs; the accepted trade waiting on the
// league and the offer whose player moves to a third team are left out.
func TestParsePendingTrades(t *testing.T) {
	got, err := ParsePendingTrades(fixture(t, "yahoo-pending-trades.xml"))
	if err != nil {
		t.Fatal(err)
	}
	proposed := time.Unix(1792219571, 0).UTC()
	first := PendingTrade{Key: "470.l.128934.pt.1", Trader: 2, Tradee: 1, ProposedAt: &proposed,
		Legs: []TradeLeg{{PlayerID: "33001", From: 2, To: 1}, {PlayerID: "31002", From: 1, To: 2}}}
	if len(got) != 2 || !reflect.DeepEqual(got[0], first) || got[1].Key != "470.l.128934.pt.2" || got[1].Trader != 1 {
		t.Fatalf("got %+v, want the two proposed trades, the first %+v", got, first)
	}
	if _, err := ParsePendingTrades([]byte("not xml <")); !errors.Is(err, ErrMalformed) {
		t.Fatalf("err %v, want ErrMalformed", err)
	}
	empty, err := ParsePendingTrades([]byte(`<fantasy_content><league><transactions count="0"/></league></fantasy_content>`))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("an empty collection read %v, %v", empty, err)
	}
}

// The member's pending trades are asked for by their own team's key and
// the pending_trade type, with the kept token.
func TestMemberPendingTrades(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	m, store, id, paths := member(t, "kept-access", now.Add(time.Hour), now, "kept-access", &fakeRefresher{})
	got, err := m.PendingTrades(context.Background(), id, 2026, "128934", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || store.reads != 1 {
		t.Fatalf("%d offers, %d reads noted", len(got), store.reads)
	}
	last := (*paths)[len(*paths)-1]
	if !strings.HasSuffix(last, "/league/470.l.128934/transactions;team_key=470.l.128934.t.1;type=pending_trade") {
		t.Fatalf("read %q", last)
	}
	if _, err := m.PendingTrades(context.Background(), id, 2026, "128934", 0); !errors.Is(err, ErrNoSuchLeague) {
		t.Fatalf("team 0: err %v, want ErrNoSuchLeague", err)
	}
}
