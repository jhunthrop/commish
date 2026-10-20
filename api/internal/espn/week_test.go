package espn

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// The week fixture is the same public league as ESPN answered view=mRoster
// with scoringPeriodId=7 (league 48153503, the 2019 season, read
// 2026-10-19), trimmed to two teams and the fields ReadWeek decodes: each
// player's period splits carry ESPN's projection and his points for
// periods 6 and 7 in the league's scoring.
const weekFixture = "testdata/league-48153503-2019-week7-rosters.json"

func weekServer(t *testing.T) (*Client, *string) {
	t.Helper()
	body, err := os.ReadFile(weekFixture)
	if err != nil {
		t.Fatal(err)
	}
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/48153503" {
			http.NotFound(w, r)
			return
		}
		asked = r.URL.RawQuery
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), Base: srv.URL}, &asked
}

func find(t *testing.T, w WeekRead, id string) WeekPlayer {
	t.Helper()
	for _, team := range w.Teams {
		for _, p := range team.Players {
			if p.ID == id {
				return p
			}
		}
	}
	t.Fatalf("no player %s", id)
	return WeekPlayer{}
}

// ESPN's own projection and points for the period, in the league's
// scoring, by player: what Lane 93's capture keeps.
func TestReadWeekCarriesESPNsProjectionAndPointsByPeriod(t *testing.T) {
	c, asked := weekServer(t)
	w, err := c.ReadWeek(context.Background(), "48153503", 2019, 7, nil)
	if err != nil {
		t.Fatal(err)
	}
	if *asked != "scoringPeriodId=7&view=mRoster" {
		t.Errorf("asked %q", *asked)
	}
	if w.Period != 7 || w.Season != 2019 || len(w.Teams) != 2 {
		t.Fatalf("read %+v", w)
	}
	cook := find(t, w, "3116593") // Dalvin Cook, projected 19.60 for week 7, scored 28
	if cook.Position != "RB" || cook.Team != "MIN" || cook.Slot != 2 || cook.Status != "ACTIVE" {
		t.Errorf("Cook %+v", cook)
	}
	seven, six := cook.Points[7], cook.Points[6]
	if seven.Projected == nil || *seven.Projected != 19.6 || seven.Actual == nil || *seven.Actual != 28 {
		t.Errorf("Cook week 7 %+v", seven)
	}
	if six.Projected == nil || *six.Projected != 20.93 || six.Actual == nil || *six.Actual != 13 {
		t.Errorf("Cook week 6 %+v", six)
	}
	bye := find(t, w, "16733") // Odell Beckham Jr. on bye in week 7: projected 0, no points split
	if p := bye.Points[7]; p.Projected == nil || *p.Projected != 0 || p.Actual != nil {
		t.Errorf("Beckham week 7 %+v", p)
	}
	if dst := find(t, w, "-16010"); dst.Position != "DEF" || dst.Team != "TEN" {
		t.Errorf("Titans D/ST %+v", dst)
	}
}

func TestReadWeekRefusesAnythingButALeagueAndAPeriod(t *testing.T) {
	c, _ := weekServer(t)
	for _, tc := range []struct {
		id             string
		season, period int
	}{{"not-a-league", 2019, 7}, {"48153503", 1999, 7}, {"48153503", 2019, 0}, {"48153503", 2019, 26}} {
		if _, err := c.ReadWeek(context.Background(), tc.id, tc.season, tc.period, nil); !errors.Is(err, ErrNotALink) {
			t.Errorf("%+v: %v", tc, err)
		}
	}
	if _, err := c.ReadWeek(context.Background(), "48153503", 2020, 7, nil); !errors.Is(err, ErrNotFound) {
		t.Errorf("another season's path: %v", err)
	}
}
