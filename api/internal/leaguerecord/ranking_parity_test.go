package leaguerecord

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The record's measures on the fixture the Python record read grades too
// (Lane 114 fix round 1, review M1: research/tests/test_record_measures_
// parity.py): the same players, the same figures printed.
const measuresFixture = "../../../research/tests/testdata/record-measures.json"

type fixtureScore struct {
	Agreement  *float64 `json:"agreement"`
	PlacesOff  *float64 `json:"placesOff"`
	Starters   int      `json:"starters"`
	StartersOf int      `json:"startersOf"`
}

type measures struct {
	Lineup struct {
		Teams, QB, RB, WR, TE int
	} `json:"lineup"`
	Players []struct {
		ID       string   `json:"id"`
		Position string   `json:"position"`
		Ours     *int     `json:"ours"`
		ESPN     *float64 `json:"espn"`
		Actual   *float64 `json:"actual"`
	} `json:"players"`
	Expected struct {
		Players int          `json:"players"`
		Ours    fixtureScore `json:"ours"`
		ESPN    fixtureScore `json:"espn"`
	} `json:"expected"`
	Rounding []struct {
		Value   float64 `json:"value"`
		Places  int     `json:"places"`
		Printed float64 `json:"printed"`
	} `json:"rounding"`
}

func readMeasures(t *testing.T) measures {
	t.Helper()
	raw, err := os.ReadFile(measuresFixture)
	if err != nil {
		t.Fatal(err)
	}
	var m measures
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func sameScore(t *testing.T, name string, got Score, want fixtureScore) {
	t.Helper()
	eq := func(a, b *float64) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }
	if !eq(got.Agreement, want.Agreement) || !eq(got.PlacesOff, want.PlacesOff) ||
		got.Starters != want.Starters || got.StartersOf != want.StartersOf {
		t.Errorf("%s: got agreement %v places off %v starters %d of %d, want %+v", name,
			deref(got.Agreement), deref(got.PlacesOff), got.Starters, got.StartersOf, want)
	}
}

func deref(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func TestRankAgreesWithTheRecordReadOnTheSharedFixture(t *testing.T) {
	m := readMeasures(t)
	var cands []Candidate
	ours, espn, actual := map[string]int{}, map[string]float64{}, map[string]float64{}
	for _, p := range m.Players {
		cands = append(cands, Candidate{ID: p.ID, Position: p.Position})
		if p.Ours != nil {
			ours[p.ID] = *p.Ours
		}
		if p.ESPN != nil {
			espn[p.ID] = *p.ESPN
		}
		if p.Actual != nil {
			actual[p.ID] = *p.Actual
		}
	}
	shape := leaguesync.Shape{Teams: m.Lineup.Teams, QB: m.Lineup.QB, RB: m.Lineup.RB, WR: m.Lineup.WR, TE: m.Lineup.TE}
	got := rank(cands, ours, espn, actual, shape)
	if got.Players != m.Expected.Players {
		t.Errorf("graded %d players, want %d (a player with no stat line is graded by neither)", got.Players, m.Expected.Players)
	}
	sameScore(t, "ours", got.Ours, m.Expected.Ours)
	sameScore(t, "espn", got.ESPN, m.Expected.ESPN)
}

func TestRoundToPrintsAsTheRecordDoes(t *testing.T) {
	for _, c := range readMeasures(t).Rounding {
		if got := roundTo(c.Value, c.Places); got != c.Printed {
			t.Errorf("roundTo(%v, %d) = %v, want %v", c.Value, c.Places, got, c.Printed)
		}
	}
}
