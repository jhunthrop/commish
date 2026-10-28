package espn

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

const tradesLeague = "48153503"

// The queue's open proposals, read with the member's cookies: both of
// them, in queue order, each with its legs, proposer and stamps; the
// accepted trade in its review period and the claim are not offers.
func TestPendingTradesReadsTheQueue(t *testing.T) {
	body := readFixture(t, "testdata/pending-trades-2026.json")
	var gotPath, gotCookie string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotCookie = r.URL.RequestURI(), r.Header.Get("Cookie")
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	c := &Client{HTTP: srv.Client(), Base: srv.URL}
	got, err := c.PendingTrades(context.Background(), writeCookies, tradesLeague, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if want := "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/48153503?view=mPendingTransactions"; gotPath != want {
		t.Errorf("read %q, want %q", gotPath, want)
	}
	if gotCookie == "" {
		t.Error("the queue was read with no cookies")
	}
	expires := time.UnixMilli(1792392370000).UTC()
	proposed := time.UnixMilli(1792219571734).UTC()
	want := PendingTrade{ID: "a1b2c3d4-0000-4000-8000-000000000002", Proposer: 2,
		Legs:       []TradeLeg{{PlayerID: "4000002", From: 2, To: 7}, {PlayerID: "9000102", From: 7, To: 2}, {PlayerID: "9000103", From: 7, To: 2}},
		ProposedAt: &proposed, ExpiresAt: &expires}
	if len(got) != 2 || got[0].ID != "a1b2c3d4-0000-4000-8000-000000000001" || got[0].Proposer != 7 {
		t.Fatalf("got %+v, want the two open proposals in queue order", got)
	}
	if !reflect.DeepEqual(got[1], want) {
		t.Errorf("the incoming offer read %+v, want %+v", got[1], want)
	}
}

// A private league's envelope without the queue key is an empty queue;
// a body that is not the league's envelope is drift, never empty.
func TestParsePendingTradesEnvelope(t *testing.T) {
	omitted := readFixture(t, "testdata/pending-omitted-2026.json")
	got, err := ParsePendingTrades(omitted, tradesLeague, 2026)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("the omitted queue read %v, %v; want an empty queue", got, err)
	}
	for name, c := range map[string]struct {
		body   string
		league string
		season int
	}{
		"another league": {string(omitted), "999", 2026},
		"another season": {string(omitted), tradesLeague, 2025},
		"not json":       {"<html>", tradesLeague, 2026},
		"no envelope":    {`{"pendingTransactions":[]}`, tradesLeague, 2026},
	} {
		if _, err := ParsePendingTrades([]byte(c.body), c.league, c.season); !errors.Is(err, ErrMalformed) {
			t.Errorf("%s: err %v, want ErrMalformed", name, err)
		}
	}
}

// A proposal with one TRADE item that does not read is dropped whole,
// never shown as the smaller trade its other items make; a DROP item
// beside the legs is passed over.
func TestParsePendingTradesNeverHalfReads(t *testing.T) {
	body := `{"id":48153503,"seasonId":2026,"pendingTransactions":[
		{"id":"half","type":"TRADE_PROPOSAL","status":"PENDING","teamId":2,"items":[
			{"type":"TRADE","playerId":1,"fromTeamId":2,"toTeamId":7},
			{"type":"TRADE","playerId":2,"fromTeamId":7,"toTeamId":2},
			{"type":"TRADE","playerId":3,"fromTeamId":7,"toTeamId":0}]},
		{"id":"with-drop","type":"TRADE_PROPOSAL","status":"PENDING","teamId":2,"items":[
			{"type":"TRADE","playerId":4,"fromTeamId":2,"toTeamId":7},
			{"type":"DROP","playerId":5,"fromTeamId":2,"toTeamId":0}]}]}`
	got, err := ParsePendingTrades([]byte(body), tradesLeague, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "with-drop" || len(got[0].Legs) != 1 || got[0].Legs[0].PlayerID != "4" {
		t.Fatalf("got %+v, want only the proposal whose legs all read, with its one leg", got)
	}
}

// Cookies ESPN refuses are ErrSignedOut, as every member read's are.
func TestPendingTradesRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer srv.Close()
	c := &Client{HTTP: srv.Client(), Base: srv.URL}
	if _, err := c.PendingTrades(context.Background(), writeCookies, tradesLeague, 2026); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("err %v, want ErrSignedOut", err)
	}
	if _, err := c.PendingTrades(context.Background(), writeCookies, "not-a-league", 2026); !errors.Is(err, ErrNotALink) {
		t.Fatalf("err %v, want ErrNotALink", err)
	}
}
