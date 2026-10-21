package inseason

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// formatBoards answers every run format's league with a rest-of-season
// board from week 6 made Saturday: the Miami and Tampa Bay backs at 120
// points in PPR, less in the other scorings, valued for the league asked.
type formatBoards struct{ t *testing.T }

func (f formatBoards) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	scale := map[apitypes.ScoringPreset]float64{apitypes.ScoringPresetPpr: 1, apitypes.ScoringPresetHalfPpr: 0.9, apitypes.ScoringPresetStandard: 0.8}[*s.Scoring.Preset]
	mia, tb, next := 120*scale, 120*scale, 60*scale
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: 6, AsOf: restRunInstant,
		Players: []boards.Player{
			{ID: "mia", Name: "A Dolphin", Position: draft.RB, Team: "MIA", Points: &mia},
			{ID: "tb", Name: "A Buccaneer", Position: draft.RB, Team: "TB", Points: &tb},
			{ID: "det", Name: "A Lion", Position: draft.RB, Team: "DET", Points: &next},
		}}
	slots, err := mock.SlotConfig(s)
	if err != nil {
		return boards.Board{}, err
	}
	return boards.For(raw, s.Teams, slots)
}

// H3: on Sunday evening the read gives the Miami back's live total and
// Over repl. in every format the run carries, each its format's board
// re-valued by LiveBoard (one rule), and the tier box's players and drop
// at the same clock.
func TestThePlayerReadCarriesEveryRunFormatAtTheReadsClock(t *testing.T) {
	sundayEvening := restSunday.Add(5 * time.Hour)
	lives, err := liveRunBoards(context.Background(), formatBoards{t}, restWeekSix(true, false), sundayEvening, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(lives) != len(RunFormats()) {
		t.Fatalf("%d boards for %d formats", len(lives), len(RunFormats()))
	}
	q := tierQuery{format: apitypes.BoardFormatPpr, ids: []string{"tb", "mia"}, next: "det"}
	out := apitypes.PlayerWeek{}
	mia, _ := lives[0].board.Player("mia")
	fillRest(&out, lives, mia, q)
	if out.RestOfSeason == nil || len(*out.RestOfSeason) != len(RunFormats()) {
		t.Fatalf("figures %v", out.RestOfSeason)
	}
	for i, fig := range *out.RestOfSeason {
		live := lives[i]
		p, _ := live.board.Player("mia")
		v := live.board.Values["mia"]
		if fig.Format != live.format || fig.Points != roundTenth(*p.Points) || fig.PointsOverReplacement == nil || *fig.PointsOverReplacement != roundTenth(v) {
			t.Fatalf("%s: %+v, the live board's %v and %v", live.format, fig, *p.Points, v)
		}
	}
	// 120 over 12 games at the run is 110 over the 11 left: the order's own figure.
	if ppr := (*out.RestOfSeason)[0]; ppr.Points != 110 {
		t.Fatalf("PPR %v, want 110", ppr.Points)
	}
	if out.RestFromWeek == nil || *out.RestFromWeek != 7 {
		t.Fatalf("from %v, want 7", out.RestFromWeek)
	}
	tier := out.Tier
	if tier == nil || len(tier.Mates) != 2 || tier.Mates[0].BoardId != "tb" || *tier.Mates[0].Points != 120 || *tier.Mates[1].Points != 110 {
		t.Fatalf("tier %+v", tier)
	}
	// The drop is the last asked player's points less the next tier's first: 110 less 60.
	if tier.Drop == nil || *tier.Drop != 50 || tier.FromWeek == nil || *tier.FromWeek != 6 || !tier.Partial {
		t.Fatalf("drop %v, from %v, partial %v", tier.Drop, tier.FromWeek, tier.Partial)
	}
}

// A tier in another format is that format's live board's, and with no
// tier asked the read carries none.
func TestTheTierIsInTheFormatAsked(t *testing.T) {
	lives, err := liveRunBoards(context.Background(), formatBoards{t}, restWeekSix(true, true), restMonday.Add(14*time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	mia, _ := lives[0].board.Player("mia")
	out := apitypes.PlayerWeek{}
	fillRest(&out, lives, mia, tierQuery{format: apitypes.BoardFormatStandard, ids: []string{"mia"}})
	if out.Tier == nil || *out.Tier.Mates[0].Points != roundTenth(96*11.0/12) || out.Tier.Drop != nil || out.Tier.Partial {
		t.Fatalf("standard tier %+v", out.Tier)
	}
	none := apitypes.PlayerWeek{}
	fillRest(&none, lives, mia, tierQuery{})
	if none.Tier != nil {
		t.Fatalf("an unasked tier %+v", none.Tier)
	}
}

// The tier's query is read and refused field by field.
func TestParseTierQuery(t *testing.T) {
	ok := httptest.NewRequest("GET", "/players/mia/week?tier=tb,mia&tier_next=det&tier_format=half_ppr", nil)
	q, bad := parseTierQuery(ok)
	if len(bad) != 0 || q.format != apitypes.BoardFormatHalfPpr || len(q.ids) != 2 || q.next != "det" {
		t.Fatalf("%+v %v", q, bad)
	}
	if q, _ := parseTierQuery(httptest.NewRequest("GET", "/players/mia/week", nil)); q.format != apitypes.BoardFormatPpr || len(q.ids) != 0 {
		t.Fatalf("no tier asked %+v", q)
	}
	many := ""
	for i := 0; i <= maxTierMates; i++ {
		many += fmt.Sprintf("p%d,", i)
	}
	for _, url := range []string{"/x?tier=" + many, "/x?tier_format=dynasty", "/x?tier=a,,b"} {
		if _, bad := parseTierQuery(httptest.NewRequest("GET", url, nil)); len(bad) == 0 {
			t.Fatalf("%s was taken", url)
		}
	}
}

// The cost of the four re-values a player read makes: the fixture's
// players, every one valued in each run format.
func BenchmarkLiveRunBoards(b *testing.B) {
	f := newFixture(b)
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderRestOfSeason, 6
	src := &askingBoards{board: f.league.Board}
	for b.Loop() {
		if _, err := liveRunBoards(context.Background(), src, f.data.Games, fixtureNow, nil); err != nil {
			b.Fatal(err)
		}
	}
}
