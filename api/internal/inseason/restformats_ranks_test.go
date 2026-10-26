package inseason

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// rankedBoards answers every run format's league with a rest-of-season
// board from week 6 made Saturday, four positions on the four clubs of
// restWeekSix (Lane 227, B206). Every player scores a share of his PPR
// points in the other scorings; the receiver loses most in standard.
type rankedBoards struct{}

func (rankedBoards) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	preset := *s.Scoring.Preset
	scale := map[apitypes.ScoringPreset]float64{apitypes.ScoringPresetPpr: 1, apitypes.ScoringPresetHalfPpr: 0.9, apitypes.ScoringPresetStandard: 0.8}[preset]
	player := func(id string, position draft.Position, team string, points float64) boards.Player {
		v := points * scale
		if position == draft.WR && preset == apitypes.ScoringPresetStandard {
			v = points * 0.4
		}
		return boards.Player{ID: id, Name: id, Position: position, Team: team, Points: &v}
	}
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Order: boards.OrderRestOfSeason, FromWeek: 6, AsOf: restRunInstant,
		Players: []boards.Player{
			player("ne-qb", draft.QB, "NE", 240),
			player("mia", draft.RB, "MIA", 120),
			player("tb", draft.RB, "TB", 120),
			player("ne-rb", draft.RB, "NE", 90),
			player("det", draft.RB, "DET", 60),
			player("det-wr", draft.WR, "DET", 200),
			player("tb-te", draft.TE, "TB", 30),
		}}
	slots, err := mock.SlotConfig(s)
	if err != nil {
		return boards.Board{}, err
	}
	return boards.For(raw, s.Teams, slots)
}

// rankedLives is every run format's board on Sunday evening, Miami and New
// England's game final: their players have 11 of their 12 games left.
func rankedLives(t *testing.T) []liveFormat {
	t.Helper()
	lives, err := liveRunBoards(context.Background(), rankedBoards{}, restWeekSix(true, false), restSunday.Add(5*time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	return lives
}

// placesIn is a player's (position rank, overall rank) in every format the
// read carries, -1 for null.
func placesIn(t *testing.T, lives []liveFormat, id string, listed func(boards.Player) bool) map[apitypes.BoardFormat][2]int {
	t.Helper()
	bp, ok := lives[0].board.Player(id)
	if !ok {
		t.Fatalf("%s is not on the board", id)
	}
	out := apitypes.PlayerWeek{}
	fillRest(&out, lives, bp, tierQuery{}, nil, formatLists{others: listed, subject: listed != nil && listed(bp)})
	if out.RestOfSeason == nil {
		t.Fatalf("%s: no rest-of-season figures", id)
	}
	or := func(v *int) int {
		if v == nil {
			return -1
		}
		return *v
	}
	got := map[apitypes.BoardFormat][2]int{}
	for _, fig := range *out.RestOfSeason {
		got[fig.Format] = [2]int{or(fig.PositionRank), or(fig.OverallRank)}
	}
	return got
}

// B206: each format's figure carries his place in that format's full order
// at the read's clock, against a hand count. On Sunday evening the Miami
// back has 110 (120 less one of 12 games) and the Tampa Bay back 120, so
// the backs go Tampa Bay, Miami, New England (82.5), Detroit (60) in every
// format. Across positions (points over replacement, which this board's
// thin positions leave at the points): New England's quarterback (220 in
// PPR), Detroit's receiver (200), then the backs, so Miami is 4th; in
// standard the receiver has 80 to Miami's 88, so Miami is 3rd there.
func TestEachFormatsFigureCarriesHisPlaceInThatOrder(t *testing.T) {
	lives := rankedLives(t)
	want := map[apitypes.BoardFormat][2]int{
		apitypes.BoardFormatPpr:       {2, 4},
		apitypes.BoardFormatHalfPpr:   {2, 4},
		apitypes.BoardFormatStandard:  {2, 3},
		apitypes.BoardFormatSuperflex: {2, 4},
	}
	got := placesIn(t, lives, "mia", nil)
	if len(got) != len(want) {
		t.Fatalf("%d formats, want %d: %v", len(got), len(want), got)
	}
	for format, w := range want {
		if got[format] != w {
			t.Fatalf("%s: position and overall %v, want %v", format, got[format], w)
		}
	}
	// The receiver: first at his position, 2nd overall in PPR, 4th in standard behind both backs.
	wr := placesIn(t, lives, "det-wr", nil)
	if wr[apitypes.BoardFormatPpr] != [2]int{1, 2} || wr[apitypes.BoardFormatStandard] != [2]int{1, 4} {
		t.Fatalf("the receiver %v", wr)
	}
}

// A player on a season-long list has no number in any format (his row
// draws the list's word), and the players behind him move up one, as the
// order numbers them; a player the order does not place has none.
func TestAListedOrUnplacedPlayerHasNoFormatRank(t *testing.T) {
	lives := rankedLives(t)
	listed := func(p boards.Player) bool { return p.ID == "tb" }
	for format, places := range placesIn(t, lives, "tb", listed) {
		if places != [2]int{-1, -1} {
			t.Fatalf("%s: the listed back has %v", format, places)
		}
	}
	if got := placesIn(t, lives, "mia", listed)[apitypes.BoardFormatPpr]; got != [2]int{1, 3} {
		t.Fatalf("Miami behind the listed back: %v, want [1 3]", got)
	}
	starts := func(draft.Position) bool { return true }
	unlisted := boards.Player{ID: "unlisted", Position: draft.RB, Team: "MIA"}
	if got := playingPlace(lives[0].board, draft.RB, starts, unlisted, func(boards.Player) bool { return false }); got != nil {
		t.Fatalf("a player off the order is placed %d", *got)
	}
}

// The count the player read makes (playingPlace) is the number the order's
// sort gives (orderOf, placesOf) for every player of the fixture's board,
// at each position and across them, with some players listed for the
// season and any tied keys among them.
func TestPlayingPlaceIsTheOrdersNumber(t *testing.T) {
	b := restOfSeasonFixture(t).league.Board
	listedIDs := map[string]bool{}
	for i, p := range b.Raw.Players {
		listedIDs[p.ID] = i%7 == 3
	}
	listed := func(p boards.Player) bool { return listedIDs[p.ID] }
	starts := func(draft.Position) bool { return true }
	for _, position := range []draft.Position{"", draft.QB, draft.RB, draft.WR, draft.TE} {
		places := placesOf(orderOf(b, position, starts), listed, nil)
		numbered := 0
		for i, p := range places.players {
			got := playingPlace(b, position, starts, p, listed)
			switch {
			case listed(p) && got != nil:
				t.Fatalf("%q: listed %s placed %d", position, p.ID, *got)
			case !listed(p) && (got == nil || *got != places.overall[i]):
				t.Fatalf("%q: %s counted %v, the order's %d", position, p.ID, got, places.overall[i])
			case !listed(p):
				numbered++
			}
		}
		if numbered == 0 || numbered == len(places.players) {
			t.Fatalf("%q: %d of %d numbered, the test proves nothing", position, numbered, len(places.players))
		}
	}
}

// The figure's ranks are the public order's own overall_rank in the same
// format: the PPR order at a position and across positions numbers Miami
// as his PPR figure does.
func TestThePPRFigureRanksAreTheOrdersOverallRank(t *testing.T) {
	lives := rankedLives(t)
	starts := func(p draft.Position) bool { return startsAny(lives[0].slots, p) }
	none := func(boards.Player) bool { return false }
	got := placesIn(t, lives, "mia", nil)[apitypes.BoardFormatPpr]
	for i, position := range []draft.Position{draft.RB, ""} {
		places := placesOf(orderOf(lives[0].board, position, starts), none, nil)
		found := false
		for j, p := range places.players {
			if p.ID != "mia" {
				continue
			}
			found = true
			if places.overall[j] != got[i] {
				t.Fatalf("%q: the order says %d, the figure %d", position, places.overall[j], got[i])
			}
		}
		if !found {
			t.Fatalf("%q: the order has no row for Miami", position)
		}
	}
}
