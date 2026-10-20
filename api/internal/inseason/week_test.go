package inseason

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

type fakeWeeks struct {
	list []WeekLeague
	err  error
}

func (f fakeWeeks) Weeks(context.Context, uuid.UUID) ([]WeekLeague, error) { return f.list, f.err }

func proj(v float64) *float64 { return &v }

func line(host string, p *float64, f apitypes.WeekFacts) apitypes.PlayerLine {
	return apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: host, Name: host}, WeekProjection: p, Facts: f}
}

var (
	kickSun  = time.Date(2026, 10, 18, 13, 30, 0, 0, time.UTC)
	kickLate = time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	nowSat   = time.Date(2026, 10, 17, 15, 0, 0, 0, time.UTC)
)

// The recorded week 6 shape: a QB change, a flex change for a starter on
// bye, a defense change for one on bye, and a TE no one can play.
func weekSlots() []apitypes.LineupSlot {
	rodgers := line("rodgers", proj(15.76), apitypes.WeekFacts{Kickoff: &kickLate})
	chase := line("chase", nil, apitypes.WeekFacts{Bye: true})
	vikings := line("vikings", nil, apitypes.WeekFacts{Bye: true})
	q := apitypes.InjuryDesignation{Status: "questionable", AsOf: time.Date(2026, 10, 16, 21, 0, 0, 0, time.UTC)}
	return []apitypes.LineupSlot{
		{Slot: "QB", Ours: line("dart", proj(20.59), apitypes.WeekFacts{Kickoff: &kickLate}), Host: &rodgers, Changed: true},
		{Slot: "WR", Ours: line("meyers", proj(9.65), apitypes.WeekFacts{Kickoff: &kickSun})},
		{Slot: "WR", Ours: line("odunze", proj(10.98), apitypes.WeekFacts{Kickoff: &kickLate, Designation: &q})},
		{Slot: "TE", Ours: line("laporta", nil, apitypes.WeekFacts{Bye: true}), NoOneCanPlay: true},
		{Slot: "FLEX", Ours: line("etienne", proj(14.19), apitypes.WeekFacts{Kickoff: &kickLate}), Host: &chase, Changed: true},
		{Slot: "DEF", Ours: line("texans", proj(7.9), apitypes.WeekFacts{Kickoff: &kickSun}), Host: &vikings, Changed: true},
	}
}

// The summary sums each Proj as printed, counts every change, and leaves
// the spot no one can play out of both totals.
func TestLineupSummaryCountsChangesAndSumsAsPrinted(t *testing.T) {
	got := lineupSummary(apitypes.LineupAdvice{Slots: weekSlots()})
	if got.Changes != 3 || len(got.Swaps) != 3 {
		t.Fatalf("changes %d swaps %d, want 3 and 3", got.Changes, len(got.Swaps))
	}
	// Ours: 20.6 + 9.7 + 11.0 + 14.2 + 7.9 = 63.4. As set: 15.8 + 9.7 + 11.0 = 36.5.
	if got.Projection == nil || *got.Projection != 63.4 || got.AsSet == nil || *got.AsSet != 36.5 || got.Gain == nil || *got.Gain != 26.9 {
		t.Fatalf("proj %v as set %v gain %v, want 63.4, 36.5, 26.9", orNone(got.Projection), orNone(got.AsSet), orNone(got.Gain))
	}
	if got.Swaps[0].Slot != "QB" || got.Swaps[0].In.HostId != "dart" || got.Swaps[0].Out == nil || got.Swaps[0].Out.HostId != "rodgers" {
		t.Fatalf("first swap %+v, want Dart in for Rodgers at QB", got.Swaps[0])
	}
}

func orNone(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// A lineup with no Proj anywhere says nothing rather than 0.
func TestLineupSummaryWithNoProjectionIsNull(t *testing.T) {
	slots := []apitypes.LineupSlot{{Slot: "QB", Ours: line("a", nil, apitypes.WeekFacts{})}}
	got := lineupSummary(apitypes.LineupAdvice{Slots: slots})
	if got.Projection != nil || got.AsSet != nil || got.Gain != nil || got.Changes != 0 {
		t.Fatalf("%+v, want null totals and no changes", got)
	}
}

// The chips come in order: the starter as set with the newest designation,
// the bye whose spot no one can play, then the first pickup with its
// week gain.
func TestRosterChipsInOrder(t *testing.T) {
	pickup := apitypes.WaiverRow{Add: line("hutchinson", proj(4.28), apitypes.WeekFacts{}), WeekGain: fp(1.8)}
	got := rosterChips(apitypes.LineupAdvice{Slots: weekSlots()}, []apitypes.WaiverRow{pickup})
	if len(got) != 3 {
		t.Fatalf("%d chips, want 3", len(got))
	}
	if got[0].Kind != apitypes.RosterChipKindStatus || got[0].Line.Player.HostId != "odunze" {
		t.Fatalf("first chip %+v, want Odunze's designation", got[0])
	}
	if got[1].Kind != apitypes.RosterChipKindBye || got[1].Line.Player.HostId != "laporta" || !got[1].Idle {
		t.Fatalf("second chip %+v, want LaPorta's bye with no one to play", got[1])
	}
	if got[2].Kind != apitypes.RosterChipKindPickup || got[2].Gain == nil || *got[2].Gain != 1.8 {
		t.Fatalf("third chip %+v, want the pickup at 1.8", got[2])
	}
	if got := rosterChips(apitypes.LineupAdvice{}, nil); len(got) != 0 {
		t.Fatalf("an empty roster made %d chips", len(got))
	}
}

// The bye chip is a starter as the platform holds him whose spot no one
// on the roster can play (Lane 66k M3): never a swap the strip names.
func TestByeChipOnlyWhereNoOneCanPlay(t *testing.T) {
	slots := weekSlots()[:5]
	got := byeStarter(slots)
	if got == nil || got.Player.HostId != "laporta" {
		t.Fatalf("%+v, want LaPorta, whose TE spot no one can play", got)
	}
	// A starter on bye the advice already replaces is the strip's swap, never a chip.
	if got := byeStarter([]apitypes.LineupSlot{weekSlots()[4]}); got != nil {
		t.Fatalf("%+v, want no chip for Chase, whom Etienne replaces", got)
	}
	slots[3].NoOneCanPlay = false
	if got := byeStarter(slots); got != nil {
		t.Fatalf("%+v, want no chip once someone can play the TE spot", got)
	}
}

// First to play is the starters as set at their earliest kickoff to come.
func TestFirstToPlayIsTheEarliestKickoffAsSet(t *testing.T) {
	got := firstToPlay(weekSlots(), nowSat)
	if len(got) != 1 || got[0].Player.HostId != "meyers" {
		t.Fatalf("%+v, want Meyers alone (the Texans are not set)", got)
	}
	if got := firstToPlay(weekSlots(), kickLate.Add(time.Hour)); len(got) != 0 {
		t.Fatalf("after every kickoff: %+v, want none", got)
	}
}

func weekService(t *testing.T, list []WeekLeague, err error) *Service {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Weeks = fakeWeeks{list: list, err: err}
	return s
}

// Every league keeps its row: in season with its week, one whose read
// failed with the sentence, one out of season with neither.
func TestWeekRouteKeepsEveryLeague(t *testing.T) {
	f := newFixture(t)
	in, failed, off := uuid.New(), uuid.New(), uuid.New()
	standing := &apitypes.LeagueStanding{Wins: 1, Losses: 4, Place: 12, Teams: 12}
	list := []WeekLeague{
		{ID: in, Name: "In season", Host: "sleeper", Phase: apitypes.LeaguePhaseInSeason, WaiversOpen: true, League: &f.league},
		{ID: failed, Name: "Failed", Host: "espn", Phase: apitypes.LeaguePhaseInSeason, Standing: standing,
			Problem: "ESPN is not answering right now."},
		{ID: off, Name: "Off", Host: "sleeper", Phase: apitypes.LeaguePhaseOffseason},
	}
	code, env := serve(t, weekService(t, list, nil), "/me/week")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%d %+v", code, env.Error)
	}
	var out apitypes.MemberWeek
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Leagues) != 3 {
		t.Fatalf("%d leagues, want 3", len(out.Leagues))
	}
	got := out.Leagues[0]
	if got.Week == 0 || got.Lineup == nil || got.Problem != nil || got.ProjectionScoring == nil || got.ReadAt == nil {
		t.Fatalf("in season: %+v, want its week with a lineup and no problem", got)
	}
	bad := out.Leagues[1]
	if bad.Problem == nil || bad.Lineup != nil || bad.Bug != nil || bad.Standing == nil || bad.Name != "Failed" {
		t.Fatalf("failed read: %+v, want the row, its standing and the sentence", bad)
	}
	if o := out.Leagues[2]; o.Problem != nil || o.Lineup != nil || o.Week != 0 || o.Chips == nil {
		t.Fatalf("out of season: %+v, want the row alone", o)
	}
}

// A league with no saved scoring keeps its row with the league page's
// sentence; a list that cannot be read is our error.
func TestWeekRouteSaysWhyAndFailsOnTheList(t *testing.T) {
	f := newFixture(t)
	unsaved := f.league
	unsaved.Saved, unsaved.SettingsNote = nil, "We could not save this league's scoring."
	code, env := serve(t, weekService(t, []WeekLeague{{ID: uuid.New(), Phase: apitypes.LeaguePhaseInSeason, League: &unsaved}}, nil), "/me/week")
	var out apitypes.MemberWeek
	if err := json.Unmarshal(env.Data, &out); err != nil || code != http.StatusOK {
		t.Fatal(code, err)
	}
	if p := out.Leagues[0].Problem; p == nil || *p != unsaved.SettingsNote {
		t.Fatalf("unsaved: %+v", out.Leagues[0])
	}
	code, _ = serve(t, weekService(t, nil, errors.New("down")), "/me/week")
	if code != http.StatusInternalServerError {
		t.Fatalf("a failed list answered %d", code)
	}
}

// downHolds fails the member's Hold tags.
type downHolds struct{}

func (downHolds) Held(context.Context, uuid.UUID) (map[string]bool, error) {
	return nil, errors.New("sheets down")
}

// A failed read of the member's Hold tags never fails the list (Lane 66k
// M1): the week answers without them.
func TestWeekRouteAnswersWithoutHolds(t *testing.T) {
	f := newFixture(t)
	s := weekService(t, []WeekLeague{{ID: uuid.New(), Phase: apitypes.LeaguePhaseInSeason, League: &f.league}}, nil)
	s.Holds = downHolds{}
	code, env := serve(t, s, "/me/week")
	var out apitypes.MemberWeek
	if err := json.Unmarshal(env.Data, &out); err != nil || code != http.StatusOK {
		t.Fatalf("%d %v", code, err)
	}
	if len(out.Leagues) != 1 || out.Leagues[0].Lineup == nil || out.Leagues[0].Problem != nil {
		t.Fatalf("%+v, want the week without the tags", out.Leagues)
	}
}

// panicFacts panics on every read, a bad snapshot in one league.
type panicFacts struct{ fakeFacts }

func (panicFacts) Data(context.Context, int) (Data, error) { panic("bad snapshot") }

// A league whose week panics keeps its row with the sentence, and the
// process and the other leagues carry on (Lane 66k rereview N2).
func TestWeekRouteRecoversALeaguesPanic(t *testing.T) {
	f := newFixture(t)
	off := WeekLeague{ID: uuid.New(), Name: "Off", Phase: apitypes.LeaguePhaseOffseason}
	s := weekService(t, []WeekLeague{{ID: uuid.New(), Name: "Bad", Phase: apitypes.LeaguePhaseInSeason, League: &f.league}, off}, nil)
	s.Facts = panicFacts{}
	code, env := serve(t, s, "/me/week")
	var out apitypes.MemberWeek
	if err := json.Unmarshal(env.Data, &out); err != nil || code != http.StatusOK {
		t.Fatalf("%d %v", code, err)
	}
	if p := out.Leagues[0].Problem; p == nil || *p != leaguesync.ReadFailedWords || out.Leagues[0].Name != "Bad" {
		t.Fatalf("%+v, want the row with the sentence", out.Leagues[0])
	}
	if out.Leagues[1].Name != "Off" || out.Leagues[1].Problem != nil {
		t.Fatalf("%+v, want the other league untouched", out.Leagues[1])
	}
}

// Ten leagues come back in their order whatever order their reads finish.
func TestWeekRouteKeepsTheOrder(t *testing.T) {
	f := newFixture(t)
	var list []WeekLeague
	for i := 0; i < 10; i++ {
		list = append(list, WeekLeague{ID: uuid.New(), Name: string(rune('A' + i)), Phase: apitypes.LeaguePhaseInSeason, League: &f.league})
	}
	_, env := serve(t, weekService(t, list, nil), "/me/week")
	var out apitypes.MemberWeek
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	for i, l := range out.Leagues {
		if l.Id != list[i].ID {
			t.Fatalf("league %d is %s, want %s", i, l.Name, list[i].Name)
		}
	}
}

// No Weeks wired answers an empty list, never null.
func TestWeekRouteWithNothingWired(t *testing.T) {
	f := newFixture(t)
	code, env := serve(t, fixtureService(t, f.league, f.data, &fakeHolds{}), "/me/week")
	if code != http.StatusOK || string(env.Data) != `{"leagues":[]}` {
		t.Fatalf("%d %s", code, env.Data)
	}
}

// The front door's nudge says the Lineup's own sentence and its state
// once every starter has played (Lane 85 fix round, M1; Lane 91), none
// before.
func TestLineupSummaryCarriesTheWeekDone(t *testing.T) {
	done, locked := WeekDoneWords(), apitypes.WeekDoneStateLocked
	got := lineupSummary(apitypes.LineupAdvice{Slots: weekSlots(), WeekDone: &done, WeekDoneState: &locked})
	if got.WeekDone == nil || *got.WeekDone != done || got.WeekDoneState == nil || *got.WeekDoneState != locked {
		t.Fatalf("week done %v, state %v", got.WeekDone, got.WeekDoneState)
	}
	if got := lineupSummary(apitypes.LineupAdvice{Slots: weekSlots()}); got.WeekDone != nil || got.WeekDoneState != nil {
		t.Errorf("week done before every starter has played: %v %v", got.WeekDone, got.WeekDoneState)
	}
}
