package inseason

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

var projectionAt = time.Date(2026, 10, 15, 13, 30, 0, 0, time.UTC)

// weekProjection holds team 1's quarterback (p000), team 1's kicker (p008,
// by his club alone), team 2's defense (p024, by his club) and team 1's
// defense (p009, whose club is on a bye), and nobody else.
func weekProjection(f fixture) boards.WeekProjection {
	return boards.WeekProjection{ReadAt: projectionAt,
		Players: map[string]boards.ProjectedPoints{"p000": {PPR: 21.374, Half: 20.1, Standard: 18.8}},
		Kickers: map[string]boards.ProjectedPoints{f.league.Player("h008").Team: {PPR: 8.4, Half: 8.4, Standard: 8.4}},
		Defenses: map[string]boards.ProjectedPoints{
			f.league.Player("h024").Team: {PPR: 7, Half: 7, Standard: 7},
			f.league.Player("h009").Team: {PPR: 9, Half: 9, Standard: 9},
		}}
}

// pairedFixture is the fixture with team 1 playing team 2 this week.
func pairedFixture(t *testing.T) fixture {
	t.Helper()
	f := newFixture(t)
	one, _ := f.league.Snap.TeamByRoster(1)
	two, _ := f.league.Snap.TeamByRoster(2)
	f.league.Snap.Matchups = []leaguesync.Side{
		{RosterID: 1, Game: 1, Starters: one.Starters, PlayerPoints: map[string]float64{}},
		{RosterID: 2, Game: 1, Starters: two.Starters, PlayerPoints: map[string]float64{}},
		{RosterID: 3, Game: 2, Starters: nil},
	}
	return f
}

func matchupOf(t *testing.T, s *Service) apitypes.MatchupBox {
	t.Helper()
	code, env := serve(t, s, leaguePath+"matchup")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("matchup: %d %+v", code, env.Error)
	}
	var box apitypes.MatchupBox
	if err := json.Unmarshal(env.Data, &box); err != nil {
		t.Fatal(err)
	}
	return box
}

// Both sides come back, the drafter's first, each starter in the
// league's slot order and the rest on the bench, every line carrying the
// week's projection where the snapshot has a row: a player's by his
// board id, a defense's by his club.
func TestMatchupIsBothSidesInSlotsWithTheWeeksProjection(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	box := matchupOf(t, s)
	if box.Week != 6 || len(box.Sides) != 2 || box.Sides[0].RosterId != 1 || box.Sides[1].RosterId != 2 {
		t.Fatalf("sides %+v", box.Sides)
	}
	if box.ProjectionReadAt == nil || !box.ProjectionReadAt.Equal(projectionAt) {
		t.Fatalf("projection read at %v", box.ProjectionReadAt)
	}
	mine := box.Sides[0]
	if len(mine.Starters) != 10 || len(mine.Bench) != 5 {
		t.Fatalf("mine: %d starters, %d bench", len(mine.Starters), len(mine.Bench))
	}
	slots := make([]string, len(mine.Starters))
	for i, st := range mine.Starters {
		slots[i] = string(st.Slot)
	}
	if got := strings.Join(slots, " "); got != "QB RB RB WR WR WR TE FLEX K DEF" {
		t.Fatalf("slots %s", got)
	}
	qb, def := mine.Starters[0].Line, mine.Starters[9].Line
	if qb.WeekProjection == nil || *qb.WeekProjection != 21.37 {
		t.Fatalf("the quarterback's projection %v, PPR to the cent", qb.WeekProjection)
	}
	if k := mine.Starters[8].Line; k.Player.Position != "K" || k.WeekProjection == nil || *k.WeekProjection != 8.4 {
		t.Fatalf("the kicker %+v: by his club when his id has no row", k)
	}
	if def.Player.Position != "DEF" || !def.Facts.Bye || def.WeekProjection != nil {
		t.Fatalf("the defense on a bye %+v: no projection, though its club has a row", def)
	}
	if rb := mine.Starters[1].Line; rb.WeekProjection != nil {
		t.Fatalf("a player with no row has none: %v", *rb.WeekProjection)
	}
	theirs := box.Sides[1].Starters
	if d := theirs[len(theirs)-1].Line; d.Player.Position != "DEF" || d.WeekProjection == nil || *d.WeekProjection != 7 {
		t.Fatalf("the opponent's defense %+v: by his club", d)
	}
	for _, st := range theirs[:len(theirs)-1] {
		if st.Line.WeekProjection != nil {
			t.Fatalf("the opponent's %s has no row: %v", st.Line.Player.Name, *st.Line.WeekProjection)
		}
	}
}

// A league scoring most like half PPR reads the half column.
func TestTheProjectionFollowsTheLeaguesFormat(t *testing.T) {
	f := pairedFixture(t)
	half := *f.league.Saved
	preset := apitypes.ScoringPresetHalfPpr
	half.Scoring = apitypes.Scoring{Preset: &preset}
	f.league.Saved = &half
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	qb := matchupOf(t, s).Sides[0].Starters[0].Line
	if qb.WeekProjection == nil || *qb.WeekProjection != 20.1 {
		t.Fatalf("half PPR: %v", qb.WeekProjection)
	}
}

// A projection read that fails leaves the column empty and the page
// answering; a side with no game this week stands alone.
func TestMatchupWithoutAProjectionOrAnOpponent(t *testing.T) {
	f := newFixture(t)
	f.league.Snap.Matchups = []leaguesync.Side{{RosterID: 1, Game: 0, Starters: nil}}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, err: errors.New("the capture is down")}
	box := matchupOf(t, s)
	if len(box.Sides) != 1 || box.ProjectionReadAt != nil {
		t.Fatalf("%+v", box)
	}
	if len(box.Sides[0].Starters) != 0 || len(box.Sides[0].Bench) != 15 {
		t.Fatalf("no starters read: %d starters, %d bench", len(box.Sides[0].Starters), len(box.Sides[0].Bench))
	}
	for _, l := range box.Sides[0].Bench {
		if l.WeekProjection != nil {
			t.Fatalf("%s: %v without a read", l.Player.Name, *l.WeekProjection)
		}
	}
}

// A player whose club has no game this week has no projection, even when
// the snapshot holds a row for him.
func TestAByeHasNoProjection(t *testing.T) {
	f := pairedFixture(t)
	every := map[string]boards.ProjectedPoints{}
	for _, p := range f.raw.Players {
		every[p.ID] = boards.ProjectedPoints{PPR: 10, Half: 10, Standard: 10}
	}
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{ReadAt: projectionAt, Players: every}, nil, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	byes, playing := 0, 0
	for _, team := range f.league.Snap.Teams {
		for _, p := range a.active(team) {
			if p.line.Player.BoardId == nil || p.line.Player.Position == "DEF" {
				continue
			}
			switch {
			case p.line.Facts.Bye && p.line.WeekProjection != nil:
				t.Fatalf("%s is on a bye with a projection %v", p.line.Player.Name, *p.line.WeekProjection)
			case p.line.Facts.Bye:
				byes++
			case p.line.WeekProjection == nil:
				t.Fatalf("%s plays with no projection", p.line.Player.Name)
			default:
				playing++
			}
		}
	}
	if byes == 0 || playing == 0 {
		t.Fatalf("the fixture holds %d byes and %d playing", byes, playing)
	}
}

// Start and sit carries the projection on its lines and its read time,
// and its basis no longer speaks of points a game.
func TestLineupCarriesTheWeeksProjection(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	_, env := serve(t, s, leaguePath+"lineup")
	var got apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.ProjectionReadAt == nil || !got.ProjectionReadAt.Equal(projectionAt) {
		t.Fatalf("projection read at %v", got.ProjectionReadAt)
	}
	found := false
	for _, slot := range got.Slots {
		if slot.Ours.Player.HostId == "h000" {
			found = slot.Ours.WeekProjection != nil && *slot.Ours.WeekProjection == 21.37
		}
	}
	if !found {
		t.Fatalf("the quarterback's projection is not on his line: %+v", got.Slots[0].Ours.WeekProjection)
	}
	if strings.Contains(got.Basis, "Points a game") {
		t.Fatalf("basis %q", got.Basis)
	}
}
