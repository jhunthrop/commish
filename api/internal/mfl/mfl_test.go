package mfl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"
)

// A link names a season and a league; anything else, or another host,
// is refused before a request could be built from it.
func TestParseLeagueLink(t *testing.T) {
	good := map[string]Ref{
		"https://www43.myfantasyleague.com/2026/home/10010":   {2026, "10010"},
		"www43.myfantasyleague.com/2026/options?L=10010&O=07": {2026, "10010"},
		"https://api.myfantasyleague.com/2025/home/71233#0":   {2025, "71233"},
	}
	for in, want := range good {
		got, err := ParseLeagueLink(in)
		if err != nil || got != want {
			t.Errorf("%q: %v %v, want %v", in, got, err, want)
		}
	}
	for _, in := range []string{
		"10010", "https://evil.example/2026/home/10010", "https://www43.myfantasyleague.com/home/10010",
		"https://www43.myfantasyleague.com/2026/home/1", "https://myfantasyleague.com.evil.example/2026/home/10010",
	} {
		if _, err := ParseLeagueLink(in); err == nil {
			t.Errorf("%q parsed", in)
		}
	}
}

// The host writes a list of one as the element itself.
func TestListReadsOneAsAList(t *testing.T) {
	one := []byte(`{"rosters":{"franchise":{"id":"0001","player":{"id":"13116","status":"ROSTER"}}}}`)
	rosters, err := DecodeRosters(one)
	if err != nil || len(rosters) != 1 || len(rosters[0].Players) != 1 || rosters[0].Franchise != 1 {
		t.Fatalf("%v %+v", err, rosters)
	}
	if _, err := DecodeRosters([]byte(`{"error":"An error has occurred - probably caused by one or more invalid parameters."}`)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unknown league read %v", err)
	}
}

// Requests to one server are a second apart, however many callers ask
// at once, no request waits more than MaxWait for its turn, and a
// redirect leaves the host's own servers never.
func TestGapAndRedirects(t *testing.T) {
	var mu sync.Mutex
	var slept []time.Duration
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	c := New()
	c.Now = func() time.Time { return now }
	c.Sleep = func(_ context.Context, d time.Duration) error {
		mu.Lock()
		defer mu.Unlock()
		slept = append(slept, d)
		return nil
	}
	for range 3 {
		if err := c.wait(context.Background(), "api.myfantasyleague.com"); err != nil {
			t.Fatal(err)
		}
	}
	if len(slept) != 2 || slept[0] != time.Second || slept[1] != 2*time.Second {
		t.Fatalf("three requests at once waited %v, want 1s and 2s", slept)
	}
	// Turns up to MaxWait away are queued; the next is refused, not slept on.
	for range 3 {
		if err := c.wait(context.Background(), "api.myfantasyleague.com"); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.wait(context.Background(), "api.myfantasyleague.com"); !errors.Is(err, ErrBusy) {
		t.Fatalf("a turn %s away answered %v, want ErrBusy", MaxWait+time.Second, err)
	}
	// Another server keeps its own bucket.
	if err := c.wait(context.Background(), "www43.myfantasyleague.com"); err != nil {
		t.Fatalf("a second server waited on the first's queue: %v", err)
	}

	srv := httptest.NewServer(http.RedirectHandler("https://evil.example/2026/export", http.StatusFound))
	defer srv.Close()
	c.BaseURL = srv.URL
	err := c.export(context.Background(), 2026, "10010", "league", url.Values{}, maxBody, &wireLeague{})
	if !errors.Is(err, ErrMalformed) {
		t.Fatalf("a redirect off the host answered %v", err)
	}
}

// A figure the host writes as NaN or Inf is refused, never carried into
// an answer that cannot then be encoded.
func TestNumberRefusesNaN(t *testing.T) {
	for _, bad := range []string{"NaN", "nan", "Inf", "-Inf", "1e400"} {
		body := []byte(`{"leagueStandings":{"franchise":{"id":"0001","h2hw":"1","h2hl":"0","h2ht":"0","pf":"` + bad + `"}}}`)
		if _, err := DecodeStandings(body); !errors.Is(err, ErrMalformed) {
			t.Errorf("points for %q answered %v", bad, err)
		}
	}
}
