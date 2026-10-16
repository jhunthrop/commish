package inseason

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

var factsRead = time.Date(2026, 10, 18, 14, 5, 0, 0, time.UTC)

func ptr(v float64) *float64 { return &v }

func TestConditionsSayTheMarginFromTheClubsSideToTheHalfPoint(t *testing.T) {
	for _, c := range []struct {
		spread float64
		side   apitypes.GameSpreadSide
		points float64
	}{
		{3, apitypes.GameSpreadSideWin, 3},
		{-3.25, apitypes.GameSpreadSideLose, 3.5},
		{0.2, apitypes.GameSpreadSideEven, 0},
		{0, apitypes.GameSpreadSideEven, 0},
	} {
		got := conditionsOf(boards.GameFact{Figures: &boards.GameFigures{Total: 55.25, Spread: c.spread, TeamPoints: 27.75, ReadAt: factsRead}})
		if got.spread == nil || got.spread.Side != c.side || got.spread.Points != c.points || !got.spread.ReadAt.Equal(factsRead) {
			t.Fatalf("spread %v: %+v, want %s by %v", c.spread, got.spread, c.side, c.points)
		}
		if got.total == nil || got.total.Points != 55.5 || got.total.TeamPoints != 28 {
			t.Fatalf("total %+v, want 55.5 and his club's 28", got.total)
		}
	}
	if empty := conditionsOf(boards.GameFact{}); empty != (conditions{}) {
		t.Fatalf("no facts held, every field null: %+v", empty)
	}
}

func TestStaleCaptureFiguresGiveWayToTheGameTablesAtSixHours(t *testing.T) {
	kickoff := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC)
	capture := &boards.GameFigures{Total: 47.5, Spread: 3, TeamPoints: 25.25, ReadAt: kickoff.Add(-FiguresStaleAfter)}
	table := &boards.GameFigures{Total: 46, Spread: 2.5, TeamPoints: 24.25, ReadAt: kickoff.Add(-96 * time.Hour)}
	fact := boards.GameFact{Figures: capture, GameTableFigures: table}
	if got := figuresAt(fact, kickoff, kickoff).Figures; got != capture {
		t.Fatalf("a read six hours before kickoff, at kickoff: %+v, want the capture's", got)
	}
	if got := figuresAt(fact, kickoff.Add(3*time.Hour), kickoff).Figures; got != capture {
		t.Fatalf("after kickoff the age is taken at kickoff: %+v", got)
	}
	late := boards.GameFact{Figures: &boards.GameFigures{Total: 47.5, Spread: 3, TeamPoints: 25.25,
		ReadAt: kickoff.Add(-FiguresStaleAfter - time.Second)}, GameTableFigures: table}
	if got := figuresAt(late, kickoff, kickoff).Figures; got != table {
		t.Fatalf("a read a second over six hours before kickoff: %+v, want the game table's", got)
	}
	if got := figuresAt(fact, capture.ReadAt.Add(FiguresStaleAfter+time.Second), kickoff.Add(48*time.Hour)).Figures; got != table {
		t.Fatalf("a read over six hours before now, kickoff later: %+v, want the game table's", got)
	}
	if got := figuresAt(boards.GameFact{GameTableFigures: table}, kickoff.Add(-time.Hour), kickoff).Figures; got != table {
		t.Fatalf("no capture read: %+v, want the game table's", got)
	}
	if got := figuresAt(boards.GameFact{Figures: late.Figures}, kickoff, kickoff).Figures; got != nil {
		t.Fatalf("stale with no game table read: %+v, want none", got)
	}
}

func TestADomeOrAVenueAbroadCarriesNoForecast(t *testing.T) {
	forecast := &boards.Forecast{TemperatureF: ptr(49), WindMph: ptr(14.1), ReadAt: factsRead}
	outdoors := conditionsOf(boards.GameFact{Forecast: forecast, Venue: &boards.Venue{Roof: boards.RoofOutdoors}})
	if outdoors.weather == nil || *outdoors.weather.WindMph != 14.1 || outdoors.weather.PrecipitationChance != nil ||
		outdoors.roof == nil || outdoors.roof.Kind != apitypes.GameRoofKindOutdoors {
		t.Fatalf("outdoors %+v %+v", outdoors.weather, outdoors.roof)
	}
	for _, v := range []boards.Venue{{Roof: boards.RoofDome}, {Roof: boards.RoofOutdoors, Abroad: true}} {
		got := conditionsOf(boards.GameFact{Forecast: forecast, Venue: &v})
		if got.weather != nil || got.roof == nil {
			t.Fatalf("venue %+v: weather %+v roof %+v", v, got.weather, got.roof)
		}
	}
	if unconfirmed := conditionsOf(boards.GameFact{Forecast: forecast}); unconfirmed.weather == nil || unconfirmed.roof != nil {
		t.Fatalf("a forecast with no confirmed venue still says the forecast: %+v", unconfirmed)
	}
}

func TestNextWeekIsTheEarliestNotFinal(t *testing.T) {
	kick := time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	games := append(game(5, "BUF", "MIA", kick, true), game(6, "NE", "NYJ", kick, false)...)
	if w := nextWeek(append(games, game(7, "BUF", "NE", kick, false)...)); w != 6 {
		t.Fatalf("next week %d, want 6", w)
	}
	if w := nextWeek(game(18, "BUF", "MIA", kick, true)); w != 18 {
		t.Fatalf("every game final: %d, want the last week", w)
	}
	if w := nextWeek(nil); w != 0 {
		t.Fatalf("no games: %d", w)
	}
}

func withGameFacts(f fixture) fixture {
	f.data.GameFacts = map[boards.ClubWeek]boards.GameFact{
		{Week: 6, Team: "ARI"}: {Figures: &boards.GameFigures{Total: 47.5, Spread: 3, ReadAt: factsRead},
			Venue: &boards.Venue{Roof: boards.RoofRetractable}},
		{Week: 6, Team: "ATL"}: {Figures: &boards.GameFigures{Total: 47.5, Spread: -3, ReadAt: factsRead},
			Venue:    &boards.Venue{Roof: boards.RoofRetractable},
			Forecast: &boards.Forecast{TemperatureF: ptr(61), WindMph: ptr(14), PrecipitationChance: ptr(20), ReadAt: factsRead}},
	}
	return f
}

func TestTheWeekGamesRouteSaysEveryClubsFacts(t *testing.T) {
	f := withGameFacts(newFixture(t))
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season = 2026
	for _, path := range []string{"/games/week?week=6", "/games/week"} {
		code, env := serve(t, s, path)
		if code != http.StatusOK || !env.Ok {
			t.Fatalf("%s: %d %+v", path, code, env.Error)
		}
		var out apitypes.GameWeek
		if err := json.Unmarshal(env.Data, &out); err != nil {
			t.Fatal(err)
		}
		if out.Season != 2026 || out.Week != 6 || len(out.Games) != 30 {
			t.Fatalf("%s: season %d week %d, %d club games", path, out.Season, out.Week, len(out.Games))
		}
		byTeam := map[string]apitypes.ClubGame{}
		for _, g := range out.Games {
			byTeam[g.Team] = g
		}
		ari, atl := byTeam["ARI"], byTeam["ATL"]
		if ari.Opponent != "ATL" || !ari.Home || ari.Spread == nil || ari.Spread.Side != apitypes.GameSpreadSideWin ||
			ari.GameTotal == nil || ari.GameTotal.Points != 47.5 || ari.Weather != nil {
			t.Fatalf("Arizona %+v", ari)
		}
		if atl.Spread == nil || atl.Spread.Side != apitypes.GameSpreadSideLose || atl.Weather == nil || *atl.Weather.WindMph != 14 {
			t.Fatalf("Atlanta %+v", atl)
		}
		if bal := byTeam["BAL"]; bal.GameTotal != nil || bal.Spread != nil || bal.Roof != nil || bal.Weather != nil {
			t.Fatalf("a club with no facts held carries none: %+v", bal)
		}
	}
	if code, env := serve(t, s, "/games/week?week=19"); code != http.StatusBadRequest || env.Error == nil {
		t.Fatalf("week 19: %d", code)
	}
}

func TestARowsWeekFactsCarryItsGame(t *testing.T) {
	f := withGameFacts(newFixture(t))
	out, ok := newFixtureAdvisor(t, f, nil).Lineup()
	if !ok {
		t.Fatal("no team")
	}
	lines := []apitypes.PlayerLine{}
	for _, s := range out.Slots {
		lines = append(lines, s.Ours)
	}
	lines = append(lines, out.Bench...)
	found := 0
	for _, l := range lines {
		facts := l.Facts
		switch l.Player.Team {
		case "ARI", "ATL":
			found++
			if facts.GameTotal == nil || facts.Spread == nil || facts.Roof == nil || facts.Roof.Kind != apitypes.GameRoofKindRetractable {
				t.Fatalf("%s's facts %+v", l.Player.Name, facts)
			}
		default:
			if facts.GameTotal != nil || facts.Spread != nil || facts.Roof != nil || facts.Weather != nil {
				t.Fatalf("%s (%s) carries another club's game: %+v", l.Player.Name, l.Player.Team, facts)
			}
		}
	}
	if found == 0 {
		t.Fatal("no row of Arizona or Atlanta in the lineup to check")
	}
}
