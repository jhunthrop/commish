package inseason

import (
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The read's clocks of week 6 (Lane 85 fix round 4): the fixture's games
// are Sunday at 1:00 Eastern.
var (
	saturdayNoon = time.Date(2026, 10, 17, 12, 0, 0, 0, east)
	mondayNoon   = time.Date(2026, 10, 19, 12, 0, 0, 0, east)
	tuesdayNoon  = time.Date(2026, 10, 20, 12, 0, 0, 0, east)
)

// thursdayClubs are the clubs of the Thursday game the Monday read has
// past its kickoff: four free agents of the fixture play for them.
var thursdayClubs = map[string]bool{"HOU": true, "IND": true}

// everyoneProjected is a week projection for every player: the rostered
// at 8, the free agents from 5 to 17, so some top a starter.
func everyoneProjected(f fixture) boards.WeekProjection {
	every := map[string]boards.ProjectedPoints{}
	for i, p := range f.raw.Players {
		v := 8.0
		if _, held := f.league.HeldBy[p.ID]; !held {
			v = 5 + float64(i%7)*2
		}
		every[p.ID] = boards.ProjectedPoints{PPR: v, Half: v, Standard: v}
	}
	return boards.WeekProjection{ReadAt: projectionAt, Players: every}
}

// rescheduled is week 6 with the Thursday clubs' game on Thursday night,
// final, and every other game on Monday night.
func rescheduled(data Data) Data {
	thursday := time.Date(2026, 10, 15, 20, 15, 0, 0, east)
	monday := time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	games := slices.Clone(data.Games)
	for i, g := range games {
		if g.Week != 6 {
			continue
		}
		games[i].Kickoff, games[i].Final = monday, false
		if thursdayClubs[g.Team] {
			games[i].Kickoff, games[i].Final = thursday, true
		}
	}
	data.Games = games
	return data
}

// everyGameFinal is week 6 with every game final, as on the Tuesday.
func everyGameFinal(data Data) Data {
	games := slices.Clone(data.Games)
	for i := range games {
		games[i].Final = true
	}
	data.Games = games
	return data
}

// withOpenSpot is the league with the member's last bench player gone
// from the roster to the pool: one roster spot open.
func withOpenSpot(f fixture) fixture {
	l := f.league
	teams := slices.Clone(l.Snap.Teams)
	for i, team := range teams {
		if team.RosterID != l.Me {
			continue
		}
		gone := team.Players[len(team.Players)-1]
		team.Players = slices.Clone(team.Players[:len(team.Players)-1])
		teams[i] = team
		held := map[string]int{}
		for id, roster := range l.HeldBy {
			if id != *l.Player(gone).BoardId {
				held[id] = roster
			}
		}
		l.HeldBy = held
	}
	l.Snap.Teams = teams
	f.league = l
	return f
}

// pickupPage is the waiver page through the real path at now, and the
// front door's strip (Pickups), which must be the same.
func pickupPage(t *testing.T, f fixture, now time.Time, position draft.Position) apitypes.WaiverAdvice {
	t.Helper()
	f.league.Snap.ReadAt = now.Add(-time.Minute)
	a, err := newAdvisor(f.league, f.data, everyoneProjected(f), nil, now)
	if err != nil {
		t.Fatal(err)
	}
	out, ok := a.Waivers(position, "")
	if !ok {
		t.Fatal("no waiver page")
	}
	if position == "" {
		strip, _ := a.Pickups()
		if len(strip) != len(out.Pickups) || (len(strip) > 0 && strip[0].Add.Player.HostId != out.Pickups[0].Add.Player.HostId) {
			t.Fatalf("the front door's strip %v is not the page's %v", names(strip), names(out.Pickups))
		}
	}
	return out
}

func names(rows []apitypes.WaiverRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Add.Player.Name
	}
	return out
}

// stateOn is a line's game state as gameStateAt gives it for his club's
// week 6 game at now, the clock the score bug reads.
func stateOn(data Data, line apitypes.PlayerLine, now time.Time) (apitypes.GameState, bool) {
	for _, g := range data.Games {
		if g.Week == 6 && g.Team == line.Player.Team {
			return gameStateAt(g, now), true
		}
	}
	return "", false
}

// assertSeasonOrder is the page in season order: rows by season Gain, no
// week figure on any row, the Proj sums held, the basis the order's, and
// the strip the first row worth making.
func assertSeasonOrder(t *testing.T, out apitypes.WaiverAdvice) {
	t.Helper()
	if out.Basis != SeasonOrderWords(6) || out.PickupOrder != apitypes.WaiverAdvicePickupOrderSeasonGain {
		t.Fatalf("basis %q, order %q, want the season order", out.Basis, out.PickupOrder)
	}
	if len(out.Rows) == 0 {
		t.Fatal("no rows")
	}
	for i, r := range out.Rows {
		if i > 0 && r.Gain > out.Rows[i-1].Gain {
			t.Fatalf("row %d %s (%v) above %s (%v): not by season Gain", i, r.Add.Player.Name, r.Gain, out.Rows[i-1].Add.Player.Name, out.Rows[i-1].Gain)
		}
		if r.WeekGain != nil || (r.Beats != nil && r.Beats.Gain != nil) {
			t.Fatalf("%s keeps a week figure: week %v beats %+v", r.Add.Player.Name, r.WeekGain, r.Beats)
		}
		for _, d := range r.Drops {
			if d.WeekGain != nil {
				t.Fatalf("%s's drop %s keeps a week gain", r.Add.Player.Name, d.HostId)
			}
		}
		if r.Pickup != (i == 0) {
			t.Errorf("row %d %s pickup %v", i, r.Add.Player.Name, r.Pickup)
		}
	}
	if out.LineupProj != nil || out.PickupsProj != nil {
		t.Errorf("the week's Proj sums are held: %v %v", out.LineupProj, out.PickupsProj)
	}
	if len(out.Pickups) != 1 || out.Pickups[0].Add.Player.HostId != out.Rows[0].Add.Player.HostId || roundTenth(out.Rows[0].Gain) <= 0 {
		t.Fatalf("the strip %v, want the first row %s by season Gain", names(out.Pickups), out.Rows[0].Add.Player.Name)
	}
}

// Saturday, no game kicked off: the week order, the strip this week's
// pick, the week gains present.
func TestThePickupRuleBeforeKickoffIsTheWeeks(t *testing.T) {
	f := newFixture(t)
	out := pickupPage(t, f, saturdayNoon, "")
	if out.Basis != WaiversBasis || out.PickupOrder != apitypes.WaiverAdvicePickupOrderWeek {
		t.Fatalf("basis %q, order %q", out.Basis, out.PickupOrder)
	}
	if len(out.Pickups) == 0 || out.LineupProj == nil || out.PickupsProj == nil {
		t.Fatalf("strip %v, proj %v %v", names(out.Pickups), out.LineupProj, out.PickupsProj)
	}
	for _, p := range out.Pickups {
		if !p.Pickup || !p.Starts || fv(p.WeekGain) <= 0 {
			t.Fatalf("card %s is not this week's pick: %+v", p.Add.Player.Name, p)
		}
	}
	for _, r := range out.Rows {
		if state, ok := stateOn(f.data, r.Add, saturdayNoon); !ok || state != apitypes.GameStateUpcoming {
			continue
		}
		if r.Drop != nil && r.WeekGain == nil {
			t.Fatalf("%s lost his week gain before kickoff", r.Add.Player.Name)
		}
	}
}

// Monday, one Thursday club among the adds past its kickoff, every other
// game still to come: the whole page goes by season Gain, every week gain
// null, the strip the first row.
func TestAThursdayAddPutsThePageInSeasonOrder(t *testing.T) {
	f := newFixture(t)
	f.data = rescheduled(f.data)
	out := pickupPage(t, f, mondayNoon, "")
	locked, upcoming := 0, 0
	for _, r := range out.Rows {
		state, ok := stateOn(f.data, r.Add, mondayNoon)
		if !ok {
			continue
		}
		if r.Add.Facts.GameState == nil || *r.Add.Facts.GameState != state {
			t.Fatalf("%s's game state %v, gameStateAt says %s", r.Add.Player.Name, r.Add.Facts.GameState, state)
		}
		if state == apitypes.GameStateUpcoming {
			upcoming++
		} else {
			locked++
		}
	}
	if locked == 0 || upcoming == 0 {
		t.Fatalf("%d adds past kickoff, %d to come: the case needs both", locked, upcoming)
	}
	assertSeasonOrder(t, out)
}

// Tuesday, every game final, one roster spot open: season order, and the
// strip names the open-spot add with no drop (review H-2).
func TestOnTuesdayTheOpenSpotAddIsThePick(t *testing.T) {
	f := withOpenSpot(newFixture(t))
	f.data = everyGameFinal(f.data)
	out := pickupPage(t, f, tuesdayNoon, "")
	assertSeasonOrder(t, out)
	if out.Pickups[0].Drop != nil {
		t.Fatalf("the open spot's pick names drop %s", out.Pickups[0].Drop.Player.Name)
	}
}

// A page narrowed to one position on Monday carries the full page's
// decision though none of its own rows has kicked off (review M-G).
func TestANarrowedPageInheritsTheSeasonOrder(t *testing.T) {
	f := newFixture(t)
	f.data = rescheduled(f.data)
	out := pickupPage(t, f, mondayNoon, draft.WR)
	for _, r := range out.Rows {
		if r.Add.Player.Position != string(draft.WR) {
			t.Fatalf("%s is no WR", r.Add.Player.Name)
		}
		for _, line := range []*apitypes.PlayerLine{&r.Add, r.Drop} {
			if line == nil {
				continue
			}
			if state, ok := stateOn(f.data, *line, mondayNoon); ok && state != apitypes.GameStateUpcoming {
				t.Fatalf("%s's game is past kickoff: the case needs a narrowed page with none", line.Player.Name)
			}
		}
	}
	assertSeasonOrder(t, out)
}
