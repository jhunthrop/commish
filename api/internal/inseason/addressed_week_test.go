package inseason

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The read's clocks of the week turn (Lane 95): the fixture's week 6 games
// are Sunday at 1:00 Eastern, week 7 opens Thursday night.
var (
	sundayMorning   = time.Date(2026, 10, 18, 10, 0, 0, 0, east)
	mondayNight     = time.Date(2026, 10, 19, 22, 0, 0, 0, east)
	thursdayMorning = time.Date(2026, 10, 22, 9, 0, 0, 0, east)
	// weekSevenFirst is week 7's first kickoff, the Thursday game.
	weekSevenFirst = time.Date(2026, 10, 22, 20, 15, 0, 0, east)
)

// withWeekSeven is the schedule with week 7 added, upcoming: the first two
// clubs on Thursday night, every other pair on Sunday at 1:00 Eastern.
func withWeekSeven(data Data) Data {
	clubs := fixtureTeams()
	sunday := time.Date(2026, 10, 25, 13, 0, 0, 0, east)
	games := slices.Clone(data.Games)
	for i := 0; i+1 < len(clubs); i += 2 {
		kickoff := sunday
		if i == 0 {
			kickoff = weekSevenFirst
		}
		games = append(games, game(7, clubs[i], clubs[i+1], kickoff, false)...)
	}
	data.Games = games
	return data
}

// weekFacts answers each week's own published projection, none for a
// week it does not hold.
type weekFacts struct {
	data   Data
	byWeek map[int]boards.WeekProjection
}

func (f weekFacts) Data(context.Context, int) (Data, error) { return f.data, nil }

func (f weekFacts) Projection(_ context.Context, _, week int) (boards.WeekProjection, error) {
	p := f.byWeek[week]
	p.Week = week
	return p, nil
}

// turnFixture is the fixture league on a clock, its data for that clock:
// week 6 upcoming on Sunday morning, final from Monday night, and on
// Thursday morning the platform on week 7.
func turnFixture(t *testing.T, now time.Time) (fixture, Data) {
	t.Helper()
	f := newFixture(t)
	data := f.data
	if !now.Before(mondayNight) {
		data = everyGameFinal(data)
	}
	data = withWeekSeven(data)
	if !now.Before(thursdayMorning) {
		f.league.Snap.Week = 7
	}
	return f, data
}

// The week an action screen addresses, through the engine at three clocks:
// Sunday morning before week 6's games, the week; Monday night with every
// starter's game final, the week after; Thursday morning with the platform
// on week 7 and its games to come, week 7.
func TestAddressedWeekAtTheClock(t *testing.T) {
	for _, tc := range []struct {
		name string
		now  time.Time
		want int
	}{
		{"Sunday morning", sundayMorning, 6},
		{"Monday night", mondayNight, 7},
		{"Thursday morning", thursdayMorning, 7},
	} {
		f, data := turnFixture(t, tc.now)
		a, err := newAdvisor(f.league, data, boards.WeekProjection{}, nil, tc.now)
		if err != nil {
			t.Fatal(err)
		}
		if got := a.addressedWeek(); got != tc.want {
			t.Errorf("%s: week %d, want %d", tc.name, got, tc.want)
		}
	}
}

// A lineup whose starters have all kicked off turns the week; one still to
// come keeps it; a week the schedule does not hold is never turned to.
func TestAddressedWeekTurnsOnKickoff(t *testing.T) {
	state := func(s apitypes.GameState) apitypes.LineupSlot {
		kickoff := kickSun
		return apitypes.LineupSlot{Ours: apitypes.PlayerLine{Facts: apitypes.WeekFacts{Kickoff: &kickoff, GameState: &s}}}
	}
	bye := apitypes.LineupSlot{Ours: apitypes.PlayerLine{Facts: apitypes.WeekFacts{Bye: true}}}
	always := func(int) bool { return true }
	for _, tc := range []struct {
		name  string
		slots []apitypes.LineupSlot
		want  int
	}{
		{"every starter kicked off or final, a bye aside", []apitypes.LineupSlot{state(apitypes.GameStateFinal), state(apitypes.GameStateKickedOff), bye}, 7},
		{"one still to come", []apitypes.LineupSlot{state(apitypes.GameStateFinal), state(apitypes.GameStateUpcoming)}, 6},
		{"no starter with a game", []apitypes.LineupSlot{bye}, 6},
	} {
		if got := addressedWeek(tc.slots, 6, always); got != tc.want {
			t.Errorf("%s: %d, want %d", tc.name, got, tc.want)
		}
	}
	final := []apitypes.LineupSlot{state(apitypes.GameStateFinal)}
	if got := addressedWeek(final, 18, func(week int) bool { return week <= 18 }); got != 18 {
		t.Errorf("the season's last week turned to %d", got)
	}
	if weekDone(final) == nil || weekDone([]apitypes.LineupSlot{state(apitypes.GameStateKickedOff)}) != nil {
		t.Error("the Lineup's sentence waits on final, the same starters the turn reads")
	}
}

// turnService is the routes on the fixture at now, with week 6's published
// projection read and week 7's only when week7 says so.
func turnService(t *testing.T, now time.Time, week7 bool) (*Service, fixture) {
	t.Helper()
	f, data := turnFixture(t, now)
	byWeek := map[int]boards.WeekProjection{6: everyoneProjected(f)}
	if week7 {
		seven := everyoneProjected(f)
		seven.ReadAt = weekSevenFirst.Add(-2 * time.Hour)
		byWeek[7] = seven
	}
	s := fixtureService(t, f.league, data, &fakeHolds{})
	s.Facts = weekFacts{data: data, byWeek: byWeek}
	s.Now = func() time.Time { return now }
	return s, f
}

func decode[T any](t *testing.T, s *Service, path string) T {
	t.Helper()
	code, env := serve(t, s, leaguePath+path)
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%s: %d %+v", path, code, env.Error)
	}
	var out T
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// Monday night with the member's starters all final: Waivers and Trades
// address week 7 (its games on the rows, the claim still naming the
// platform's week 6), and with week 7's projection not yet read the pickups
// go by the season Gain and the page says when it arrives; the Lineup stays
// on week 6, the platform's.
func TestMondayNightAddressesNextWeek(t *testing.T) {
	s, _ := turnService(t, mondayNight, false)
	w := decode[apitypes.WaiverAdvice](t, s, "waivers")
	if w.Week != 6 || w.ForWeek == nil || *w.ForWeek != 7 {
		t.Fatalf("waivers week %d for %v, want the platform's 6 for 7", w.Week, w.ForWeek)
	}
	if w.ProjectionReadAt != nil || w.ProjectionArrivesAt == nil || !w.ProjectionArrivesAt.Equal(weekSevenFirst.Add(-ProjectionCaptureLead)) {
		t.Fatalf("projection read %v arrives %v, want none read and Thursday's slot", w.ProjectionReadAt, w.ProjectionArrivesAt)
	}
	if w.PickupOrder != seasonOrder || w.Basis != UnprojectedOrderWords(7) {
		t.Fatalf("order %s %q, want the season Gain's until week 7's projection", w.PickupOrder, w.Basis)
	}
	for _, r := range w.Rows {
		if r.Add.Facts.Week != 7 || r.Add.Facts.Played || r.WeekGain != nil {
			t.Fatalf("row %s: week %d, want his week 7 game to come and no week figure", r.Add.Player.Name, r.Add.Facts.Week)
		}
	}
	tr := decode[apitypes.TradeAdvice](t, s, "trades")
	if tr.Week != 6 || tr.ForWeek == nil || *tr.ForWeek != 7 || tr.ProjectionArrivesAt == nil {
		t.Fatalf("trades week %d for %v arrives %v, want week 7 with its projection to come", tr.Week, tr.ForWeek, tr.ProjectionArrivesAt)
	}
	l := decode[apitypes.LineupAdvice](t, s, "lineup")
	if l.Week != 6 || l.WeekDone == nil {
		t.Fatalf("lineup week %d done %v, want week 6 played", l.Week, l.WeekDone)
	}
}

// Once week 7's projection is read the page is in the week order on it,
// with no arrival to say.
func TestNextWeekProjectionOrdersTheWeek(t *testing.T) {
	s, _ := turnService(t, mondayNight, true)
	w := decode[apitypes.WaiverAdvice](t, s, "waivers")
	if *w.ForWeek != 7 || w.ProjectionReadAt == nil || !w.ProjectionReadAt.Equal(weekSevenFirst.Add(-2*time.Hour)) || w.ProjectionArrivesAt != nil {
		t.Fatalf("for %d read %v arrives %v, want week 7's read", *w.ForWeek, w.ProjectionReadAt, w.ProjectionArrivesAt)
	}
	if w.PickupOrder != weekOrder {
		t.Fatalf("order %s, want the week's", w.PickupOrder)
	}
}

// Sunday morning and Thursday morning the pages address the platform's
// week, its projection read.
func TestActionScreensKeepAWeekToCome(t *testing.T) {
	for _, tc := range []struct {
		name string
		now  time.Time
		want int
	}{
		{"Sunday morning", sundayMorning, 6},
		{"Thursday morning", thursdayMorning, 7},
	} {
		s, _ := turnService(t, tc.now, true)
		w := decode[apitypes.WaiverAdvice](t, s, "waivers")
		if w.Week != tc.want || *w.ForWeek != tc.want {
			t.Errorf("%s: week %d for %d, want %d", tc.name, w.Week, *w.ForWeek, tc.want)
		}
	}
}

// A starter's designation listed before his week 6 game is spent on
// Monday night: the front door's facts are week 7's, and only a listing
// after that game is one of them. Sunday morning the same listing is the
// week's fact.
func TestFrontDoorDropsASpentListing(t *testing.T) {
	friday := time.Date(2026, 10, 16, 16, 0, 0, 0, east)
	mondayEvening := time.Date(2026, 10, 19, 19, 0, 0, 0, east)
	for _, tc := range []struct {
		name   string
		now    time.Time
		listed time.Time
		week   int
		chip   bool
	}{
		{"Sunday morning, listed Friday", sundayMorning, friday, 6, true},
		{"Monday night, listed Friday", mondayNight, friday, 7, false},
		{"Monday night, listed after his game", mondayNight, mondayEvening, 7, true},
	} {
		f, data := turnFixture(t, tc.now)
		boardID := playingStarter(t, f, data)
		listed := tc.listed
		data.Designations = map[string]boards.Designation{boardID: {Code: "O", AsOf: mondayEvening, Listed: &listed}}
		s := fixtureService(t, f.league, data, &fakeHolds{})
		s.Facts = weekFacts{data: data, byWeek: map[int]boards.WeekProjection{6: everyoneProjected(f)}}
		s.Now = func() time.Time { return tc.now }
		league := f.league
		s.Weeks = fakeWeeks{list: []WeekLeague{{Name: "Fixture", Host: "sleeper", Phase: apitypes.LeaguePhaseInSeason, League: &league}}}
		code, env := serve(t, s, "/me/week")
		if code != http.StatusOK {
			t.Fatalf("%s: %d", tc.name, code)
		}
		var out apitypes.MemberWeek
		if err := json.Unmarshal(env.Data, &out); err != nil {
			t.Fatal(err)
		}
		got := out.Leagues[0]
		if got.Week != 6 || got.ChipsWeek == nil || *got.ChipsWeek != tc.week {
			t.Fatalf("%s: week %d chips for %v, want 6 and %d", tc.name, got.Week, got.ChipsWeek, tc.week)
		}
		status := false
		for _, c := range got.Chips {
			status = status || c.Kind == apitypes.RosterChipKindStatus
		}
		if status != tc.chip {
			t.Errorf("%s: status chip %v, want %v (%+v)", tc.name, status, tc.chip, got.Chips)
		}
	}
}

// playingStarter is the board id of the member's first starter whose club
// plays in week 6.
func playingStarter(t *testing.T, f fixture, data Data) string {
	t.Helper()
	playing := map[string]bool{}
	for _, g := range data.Games {
		if g.Week == 6 {
			playing[g.Team] = true
		}
	}
	team, _ := f.league.Snap.TeamByRoster(f.league.Me)
	for _, host := range team.Starters {
		if lp := f.league.Player(host); lp.BoardId != nil && playing[lp.Team] {
			return *lp.BoardId
		}
	}
	t.Fatal("no starter of the member's plays in week 6")
	return ""
}
