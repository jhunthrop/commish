package espn

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"testing"
)

// The fixture is a real public league's settings as ESPN answered them
// (league 48153503, the 2019 season, read 2026-10-14).
const fixture = "testdata/league-48153503-2019.json"

func serve(t *testing.T) *Client {
	t.Helper()
	body, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/48153503":
			if r.URL.Query().Get("view") != "mSettings" || r.Header.Get("User-Agent") != UserAgent {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			_, _ = w.Write(body)
		case "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/368876":
			http.Error(w, `{"messages":["You are not authorized"]}`, http.StatusUnauthorized)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), Base: srv.URL}
}

func TestParse(t *testing.T) {
	cases := map[string]Ref{
		"48153503": {LeagueID: "48153503"},
		"https://fantasy.espn.com/football/league?leagueId=48153503&seasonId=2019":     {LeagueID: "48153503", Season: 2019},
		" https://fantasy.espn.com/football/league/settings?leagueId=7&seasonId=2025 ": {LeagueID: "7", Season: 2025},
	}
	for in, want := range cases {
		if got, err := Parse(in); err != nil || got != want {
			t.Errorf("Parse(%q) = %+v, %v; want %+v", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "https://evil.example/football/league?leagueId=1", "https://fantasy.espn.com/football/league",
		"https://fantasy.espn.com/football/league?leagueId=12&seasonId=1800", "javascript:alert(1)", "https://espn.com.evil.io/?leagueId=1"} {
		if _, err := Parse(bad); !errors.Is(err, ErrNotALink) {
			t.Errorf("Parse(%q) = %v, want ErrNotALink", bad, err)
		}
	}
}

// The real league maps to the rules ESPN states, every rule the 21 do not
// carry is named with its figure, and the rules it leaves out take the
// standard figure.
func TestMapRealLeague(t *testing.T) {
	c := serve(t)
	league, err := c.League(context.Background(), Ref{LeagueID: "48153503"}, 2019)
	if err != nil {
		t.Fatal(err)
	}
	if league.Name != "Agbo Superhero League" {
		t.Errorf("name %q", league.Name)
	}
	im := Map(league.Items)
	want := map[string]float64{
		"points_per_passing_yard": 0.04, "points_per_passing_touchdown": 4, "points_per_interception": -1,
		"points_per_rushing_yard": 0.1, "points_per_rushing_touchdown": 6, "points_per_receiving_yard": 0.1,
		"points_per_receiving_touchdown": 6, "points_per_reception": 1, "points_per_fumble_lost": -2,
		"te_reception_bonus": 0, "points_per_field_goal": 3, "points_per_extra_point": 1, "points_per_sack": 1,
		"points_per_defensive_interception": 2, "points_per_defensive_touchdown": 6, "points_per_two_point_conversion": 2,
		"points_per_field_goal_missed": -1, "points_per_extra_point_missed": 0, "points_per_return_touchdown": 6,
		"points_per_defensive_fumble_recovery": 2, "points_per_safety": 2,
	}
	for k, v := range want {
		if got := im.Rules[k]; got != v {
			t.Errorf("%s = %g, want %g", k, got, v)
		}
	}
	if len(im.Rules) != len(want) {
		t.Errorf("%d rules, want %d", len(im.Rules), len(want))
	}
	for _, d := range []string{"field goal made, 40 to 49 yards 4 (read as 3)", "field goal made, 50+ yards 5 (read as 3)",
		"400+ yard passing game 1", "defense, 0 points allowed 10", "defense, blocked kick 2", "fumble recovered for a TD 6"} {
		if !slices.Contains(im.Dropped, d) {
			t.Errorf("dropped %q, want %q among them", im.Dropped, d)
		}
	}
	if !slices.Equal(im.Defaulted, []string{"te_reception_bonus 0", "points_per_extra_point_missed 0"}) {
		t.Errorf("defaulted %q", im.Defaulted)
	}
}

func TestPrivateAndMissing(t *testing.T) {
	c := serve(t)
	if _, err := c.League(context.Background(), Ref{LeagueID: "368876"}, 2019); !errors.Is(err, ErrPrivate) {
		t.Errorf("a private league: %v", err)
	}
	if _, err := c.League(context.Background(), Ref{LeagueID: "1"}, 2019); !errors.Is(err, ErrNotFound) {
		t.Errorf("a missing league: %v", err)
	}
	if _, err := c.League(context.Background(), Ref{LeagueID: "../x"}, 2019); !errors.Is(err, ErrNotALink) {
		t.Errorf("a path for an id: %v", err)
	}
}

// A tight end's reception override beyond everyone's is the TE premium.
func TestTightEndOverride(t *testing.T) {
	im := Map([]Item{{StatID: 53, Points: 1, Overrides: map[string]float64{"6": 1.5}}})
	if im.Rules["te_reception_bonus"] != 0.5 || im.Rules["points_per_reception"] != 1 {
		t.Errorf("rules %v", im.Rules)
	}
}
