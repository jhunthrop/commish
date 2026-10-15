package espn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// The full fixture is a real public league as ESPN answered the four views
// (league 48153503, the 2019 season, read 2026-10-14), trimmed to what the
// reader reads and with every member's id and name replaced.
const fullFixture = "testdata/league-48153503-2019-full.json"

var testCookies = Cookies{SWID: "{00000001-0000-4000-8000-000000000001}", S2: strings.Repeat("AEB", 30) + "%2B%3D"}

func fullServer(t *testing.T) (*Client, *[]string) {
	t.Helper()
	full, err := os.ReadFile(fullFixture)
	if err != nil {
		t.Fatal(err)
	}
	fan, err := os.ReadFile("testdata/fan-2026.json")
	if err != nil {
		t.Fatal(err)
	}
	var cookies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookies = append(cookies, r.Header.Get("Cookie"))
		switch {
		case r.URL.Path == "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/48153503":
			if got := r.URL.Query()["view"]; strings.Join(got, ",") != "mRoster,mSettings,mMatchup,mTeam" {
				http.Error(w, "views", http.StatusBadRequest)
				return
			}
			_, _ = w.Write(full)
		case r.URL.Path == "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1":
			http.Error(w, "{}", http.StatusUnauthorized)
		case strings.HasPrefix(r.URL.Path, "/apis/v2/fans/"):
			if r.Header.Get("Cookie") != testCookies.header() {
				http.Error(w, "{}", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write(fan)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), Base: srv.URL, FanBase: srv.URL}, &cookies
}

// A whole league: fourteen teams with owners, records and rosters by
// slot, the current matchup period's games, the lineup and the scoring.
func TestReadFullLeague(t *testing.T) {
	c, sent := fullServer(t)
	l, err := c.Read(context.Background(), "48153503", 2019, nil)
	if err != nil {
		t.Fatal(err)
	}
	if l.ID != "48153503" || l.Season != 2019 || l.Name != "Agbo Superhero League" || len(l.Teams) != 14 || l.MatchupPeriod != 16 {
		t.Fatalf("league %+v", l.Name)
	}
	first := l.Teams[0]
	if first.ID != 1 || first.Name != "TEAM BERRY" || first.Wins != 8 || first.Losses != 5 || len(first.Owners) != 1 || len(first.Roster) != 12 {
		t.Fatalf("team 1: %+v", first)
	}
	var dst, flex Player
	for _, p := range first.Roster {
		switch p.ID {
		case "-16033":
			dst = p
		case "16733":
			flex = p
		}
	}
	if dst.Position != "DEF" || dst.Team != "BAL" || dst.Slot != 16 {
		t.Fatalf("the defense: %+v", dst)
	}
	if flex.Name != "Odell Beckham Jr." || flex.Position != "WR" || flex.Team != "CLE" || SlotName(flex.Slot) != "FLEX" {
		t.Fatalf("a flex starter: %+v", flex)
	}
	if len(l.Games) != 7 || l.Games[0].Home != 3 || l.Games[0].Away != 9 || l.Games[0].HomePoints != 84 {
		t.Fatalf("games %+v", l.Games)
	}
	if l.LineupSlotCount[23] != 2 || l.LineupSlotCount[20] != 5 || len(l.Items) == 0 || len(l.Members) != 17 {
		t.Fatalf("lineup %v, %d items, %d members", l.LineupSlotCount, len(l.Items), len(l.Members))
	}
	if (*sent)[0] != "" {
		t.Fatal("a public read sent cookies")
	}
}

// Cookies ride the read when given, and a refusal with them is a signed
// out connection, without them a private league.
func TestReadWithCookies(t *testing.T) {
	c, sent := fullServer(t)
	if _, err := c.Read(context.Background(), "48153503", 2019, &testCookies); err != nil {
		t.Fatal(err)
	}
	if (*sent)[0] != testCookies.header() {
		t.Fatal("the cookies did not ride the read")
	}
	if _, err := c.Read(context.Background(), "1", 2026, &testCookies); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("refused with cookies: %v", err)
	}
	if _, err := c.Read(context.Background(), "1", 2026, nil); !errors.Is(err, ErrPrivate) {
		t.Fatalf("refused without: %v", err)
	}
	if _, err := c.Read(context.Background(), "1;x", 2026, nil); !errors.Is(err, ErrNotALink) {
		t.Fatalf("a bad id: %v", err)
	}
}

// The fan API's list: the season's football leagues only, each once.
func TestMyLeagues(t *testing.T) {
	c, _ := fullServer(t)
	list, err := c.MyLeagues(context.Background(), testCookies, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].LeagueID != "48153503" || list[0].TeamName != "TEAM BERRY" || list[0].Teams != 14 || list[0].Name != "Agbo Superhero League" {
		t.Fatalf("leagues %+v", list)
	}
	bad := Cookies{SWID: testCookies.SWID, S2: strings.Repeat("Z", 60)}
	if _, err := c.MyLeagues(context.Background(), bad, 2026); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("cookies the fan API refuses: %v", err)
	}
}

func TestCookiesShapeAndPrinting(t *testing.T) {
	if !testCookies.Valid() {
		t.Fatal("good cookies refused")
	}
	for _, bad := range []Cookies{{SWID: "nope", S2: testCookies.S2}, {SWID: testCookies.SWID, S2: "short"}, {SWID: testCookies.SWID, S2: testCookies.S2 + "\r\nX: y"}} {
		if bad.Valid() {
			t.Fatalf("%q accepted", bad.SWID)
		}
	}
	if s := fmt.Sprintf("%v %+v %#v", testCookies, testCookies, testCookies); strings.Contains(s, "AEB") {
		t.Fatalf("cookies printed: %s", s)
	}
}

// L8: no answer, however malformed or mistyped, makes a reader panic.
func FuzzReadLeague(f *testing.F) {
	full, err := os.ReadFile(fullFixture)
	if err != nil {
		f.Fatal(err)
	}
	f.Add(full)
	f.Add([]byte(`{"id":"x","teams":[{"roster":{"entries":[{"playerId":"y"}]}}]}`))
	f.Add([]byte(`{"id":1,"teams":[{}],"schedule":[{"matchupPeriodId":0,"away":null}]}`))
	f.Fuzz(func(t *testing.T, body []byte) {
		var wire wireFull
		if json.Unmarshal(body, &wire) == nil {
			_, _ = checkFull(wire)
		}
	})
}

func FuzzParseMyLeagues(f *testing.F) {
	fan, err := os.ReadFile("testdata/fan-2026.json")
	if err != nil {
		f.Fatal(err)
	}
	f.Add(fan)
	f.Add([]byte(`{"preferences":[{"metaData":{"entry":{"abbrev":"ffl","seasonId":2026,"groups":[]}}}]}`))
	f.Fuzz(func(t *testing.T, body []byte) {
		_, _ = ParseMyLeagues(body, 2026)
	})
}

// A mistyped answer is ErrMalformed, never a league.
func TestReadRefusesMistypedAnswers(t *testing.T) {
	for _, body := range []string{`{"id":"x"}`, `[]`, `{"id":1,"teams":[]}`} {
		var wire wireFull
		err := json.Unmarshal([]byte(body), &wire)
		if err == nil {
			_, err = checkFull(wire)
		}
		if err == nil {
			t.Fatalf("%s read as a league", body)
		}
	}
	if _, err := ParseMyLeagues([]byte(`{"preferences":"x"}`), 2026); !errors.Is(err, ErrMalformed) {
		t.Fatalf("a mistyped fan answer: %v", err)
	}
}

// Public reads a league's settings alone with no cookies: an answer is a
// league the public reads, a refusal one it cannot, and anything else is
// not known.
func TestPublic(t *testing.T) {
	var sent []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent = append(sent, r.Header.Get("Cookie")+"|"+r.URL.RawQuery)
		switch r.URL.Path {
		case "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1081607624":
			_, _ = w.Write([]byte(`{"id":1081607624,"settings":{"name":"x"}}`))
		case "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1":
			http.Error(w, "{}", http.StatusUnauthorized)
		case "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/2":
			http.Error(w, "{}", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	c := &Client{HTTP: srv.Client(), Base: srv.URL}
	ctx := context.Background()
	if public, err := c.Public(ctx, "1081607624", 2026); err != nil || !public {
		t.Fatalf("a public league: %v %v", public, err)
	}
	if public, err := c.Public(ctx, "1", 2026); err != nil || public {
		t.Fatalf("a private league: %v %v", public, err)
	}
	if _, err := c.Public(ctx, "2", 2026); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("ESPN not answering: %v", err)
	}
	if _, err := c.Public(ctx, "9", 2026); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no league: %v", err)
	}
	if _, err := c.Public(ctx, "1;x", 2026); !errors.Is(err, ErrNotALink) {
		t.Fatalf("a bad id: %v", err)
	}
	for _, s := range sent {
		if s != "|view=mSettings" {
			t.Fatalf("a public check sent %q", s)
		}
	}
}
