package inseason

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// A player designated to return is this week's question, never
// season-long (Lane 153, the Jordan Mason report): through the engine on
// the fixture league's Thursday of week 6 (its games Sunday Oct 18),
// Team 1's four injured-reserve players read the provider's return dates.
//   - p001, the Mason shape: back Sunday Oct 18, this week. Questionable,
//     returning that day, no list, no since, ranked as playing and kept
//     in his starting slot.
//   - p002, back Oct 25, next week: still on injured reserve, unranked,
//     the day carried for the row to say when.
//   - p003, a return date already passed (Oct 12): injured reserve as
//     before, no day carried.
//   - p004, no return date: injured reserve as before.
func TestADesignatedToReturnPlayerIsThisWeeksQuestion(t *testing.T) {
	f := newFixture(t)
	listed := fixtureNow.Add(-24 * time.Hour)
	since := time.Date(2026, 9, 22, 15, 0, 0, 0, time.UTC)
	ir := func(code string, on *time.Time) boards.Designation {
		return boards.Designation{Code: code, AsOf: listed, Since: &since, Listed: &since, ReturnOn: on}
	}
	f.data.Designations["p001"] = ir("Injured Reserve - Designated to Return", eastDay(time.October, 18))
	f.data.Designations["p002"] = ir("IR", eastDay(time.October, 25))
	f.data.Designations["p003"] = ir("IR", eastDay(time.October, 12))
	f.data.Designations["p004"] = ir("IR", nil)
	a := newFixtureAdvisor(t, f, nil)
	advice, ok := a.Lineup()
	if !ok {
		t.Fatal("no lineup")
	}
	starting := map[string]bool{}
	lines := map[string]apitypes.PlayerLine{}
	for _, slot := range advice.Slots {
		starting[slot.Ours.Player.HostId] = true
		lines[slot.Ours.Player.HostId] = slot.Ours
		if slot.Host != nil {
			lines[slot.Host.Player.HostId] = *slot.Host
		}
	}
	for _, line := range append(append([]apitypes.PlayerLine(nil), advice.Bench...), advice.Reserve...) {
		lines[line.Player.HostId] = line
	}

	mason := lines["h001"]
	d := mason.Facts.Designation
	if d == nil || d.Status != apitypes.DesignationStatusQuestionable || d.Returning == nil || d.Returning.String() != "2026-10-18" {
		t.Fatalf("the Mason shape reads %+v, want questionable returning 2026-10-18", d)
	}
	if d.SeasonLong != nil || d.Since != nil || d.Listed != nil || d.CarriedOver != nil || d.ReturnWeek != nil {
		t.Fatalf("the Mason shape carries a list's fields: %+v", d)
	}
	if mason.PositionRank == nil || *mason.PositionRank != a.playingRanks()["p001"] {
		t.Fatalf("the Mason shape's rank %v, want his playing rank %d", mason.PositionRank, a.playingRanks()["p001"])
	}
	if !starting["h001"] {
		t.Fatal("the Mason shape left his starting slot: a week's designation moves nothing")
	}
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"returning":"2026-10-18"`) || strings.Contains(string(raw), "season_long") {
		t.Fatalf("the wire designation %s", raw)
	}

	later := lines["h002"].Facts.Designation
	if later == nil || later.Status != apitypes.DesignationStatusInjuredReserve || later.SeasonLong == nil || !*later.SeasonLong ||
		later.Returning == nil || later.Returning.String() != "2026-10-25" || later.Since == nil {
		t.Fatalf("back next week reads %+v, want injured reserve since Sep 22 returning 2026-10-25", later)
	}
	if lines["h002"].PositionRank != nil {
		t.Fatalf("back next week is ranked %d", *lines["h002"].PositionRank)
	}
	for _, id := range []string{"h003", "h004"} {
		got := lines[id].Facts.Designation
		if got == nil || got.Status != apitypes.DesignationStatusInjuredReserve || got.Returning != nil || got.SeasonLong == nil {
			t.Fatalf("%s reads %+v, want injured reserve with no return day", id, got)
		}
	}
}

// The return day is read against his own club's game (Lane 153 fix round
// 1): on the Wednesday of week 6, a player dated back Sunday Oct 18 is this
// week's question on a Sunday club; on a Thursday-night club his only game
// this week comes first, so he stays on his list with the day carried; on
// a club with a bye he stays on his list with the day too; dated back on
// the Thursday itself the Thursday club's player is this week's.
func TestTheReturnDayIsReadAgainstHisClubsGame(t *testing.T) {
	var games []boards.TeamWeek
	games = append(games, game(6, "ARI", "ATL", time.Date(2026, 10, 15, 20, 15, 0, 0, east), false)...)
	games = append(games, game(6, "BAL", "BUF", time.Date(2026, 10, 18, 13, 0, 0, 0, east), false)...)
	asOf := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	data := Data{Games: games, Designations: map[string]boards.Designation{
		"sunday":   {Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 18)},
		"thursday": {Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 18)},
		"bye":      {Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 18)},
		"thu-back": {Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 15)},
	}}
	s := NewSeason(data, RulesOf(*fixtureSettings().Scoring.Custom), 6, time.Date(2026, 10, 14, 12, 0, 0, 0, east))
	for _, tc := range []struct {
		id, team, status string
		seasonLong       bool
	}{
		{"sunday", "BAL", boards.StatusQuestionable, false},
		{"thursday", "ARI", boards.StatusInjuredReserve, true},
		{"bye", "CAR", boards.StatusInjuredReserve, true},
		{"thu-back", "ATL", boards.StatusQuestionable, false},
	} {
		d := s.For(Player{BoardID: tc.id, Team: tc.team}).Designation
		if d == nil || d.Status != tc.status || d.SeasonLong != tc.seasonLong || d.Returning == nil {
			t.Errorf("%s (%s): %+v, want %s, season-long %v, the day carried", tc.id, tc.team, d, tc.status, tc.seasonLong)
		}
	}
}

// The rule's week is the Season's, at its clock: on Monday after week
// 6's Sunday, Oct 18 has passed and says nothing; the day before, it is
// still this week's.
func TestTheReturnDayIsReadAtTheSeasonsClock(t *testing.T) {
	data := Data{Games: fixtureData(fixtureTeams()).Games, Designations: map[string]boards.Designation{
		"p": {Code: "IR", AsOf: fixtureNow, ReturnOn: eastDay(time.October, 18)},
	}}
	rules := RulesOf(*fixtureSettings().Scoring.Custom)
	for _, tc := range []struct {
		name   string
		now    time.Time
		status string
	}{
		{"Saturday", time.Date(2026, 10, 17, 12, 0, 0, 0, east), boards.StatusQuestionable},
		{"Sunday night", time.Date(2026, 10, 18, 23, 0, 0, 0, east), boards.StatusQuestionable},
		{"Monday", time.Date(2026, 10, 19, 9, 0, 0, 0, east), boards.StatusInjuredReserve},
	} {
		d := NewSeason(data, rules, 6, tc.now).For(Player{BoardID: "p", Team: "ARI"}).Designation
		if d == nil || d.Status != tc.status {
			t.Errorf("%s: %+v, want %s", tc.name, d, tc.status)
		}
	}
}
