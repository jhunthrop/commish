package mfl_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/mfl/mfltest"
)

// The owner view's offers, both ways, each with its sides the offering
// franchise's way round; an offer carrying a draft pick says so.
func TestPendingTrades(t *testing.T) {
	srv := mfltest.New(t)
	got, err := srv.Client().PendingTrades(context.Background(), mfl.Session{UserID: mfltest.Session}, "", mfltest.Season, mfltest.LeagueID)
	if err != nil {
		t.Fatal(err)
	}
	proposed, expires := time.Unix(1792265989, 0).UTC(), time.Unix(1792868400, 0).UTC()
	first := mfl.PendingTrade{ID: "1002", Offering: 1, OfferedTo: 3, GiveUp: []string{"14802"}, Receive: []string{"15757"},
		ProposedAt: &proposed, ExpiresAt: &expires}
	if len(got) != 3 || !reflect.DeepEqual(got[0], first) {
		t.Fatalf("got %+v, want three offers, the first %+v", got, first)
	}
	if got[1].Offering != mfltest.Franchise || got[1].Assets || !got[2].Assets || !reflect.DeepEqual(got[2].GiveUp, []string{"15694"}) {
		t.Fatalf("the member's own offer or the pick's: %+v %+v", got[1], got[2])
	}
	if _, err := srv.Client().PendingTrades(context.Background(), mfl.Session{UserID: "bm9wZQ=="}, "", mfltest.Season, mfltest.LeagueID); !errors.Is(err, mfl.ErrSignedOut) {
		t.Fatalf("a refused session answered %v", err)
	}
}

// One offer arrives as an object, none as an empty list; an answer that
// names no list is drift.
func TestDecodePendingTrades(t *testing.T) {
	one, err := mfl.DecodePendingTrades(mfltest.Testdata(t, "pending-trades-one.json"))
	if err != nil || len(one) != 1 || one[0].ID != "1002" {
		t.Fatalf("one: %+v %v", one, err)
	}
	for _, body := range []string{`{"pendingTrades":""}`, `{"pendingTrades":{}}`, `{"version":"1.0","pendingTrades":{"pendingTrade":[]}}`} {
		got, err := mfl.DecodePendingTrades([]byte(body))
		if err != nil || got == nil || len(got) != 0 {
			t.Errorf("%s: %+v %v, want none", body, got, err)
		}
	}
	if _, err := mfl.DecodePendingTrades([]byte(`{"version":"1.0"}`)); !errors.Is(err, mfl.ErrMalformed) {
		t.Fatalf("no list: %v", err)
	}
	bad := `{"pendingTrades":{"pendingTrade":{"trade_id":"9","offeringteam":"0001","offeredto":"0003","will_give_up":"drop table,","will_receive":"15757,"}}}`
	if got, err := mfl.DecodePendingTrades([]byte(bad)); err != nil || len(got) != 0 {
		t.Fatalf("a row that does not read: %+v %v", got, err)
	}
}
