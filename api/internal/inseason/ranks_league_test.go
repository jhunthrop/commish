package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// restRoutesWith is restRoutes with the fixture changed before the
// service is built.
func restRoutesWith(t *testing.T, change func(*fixture)) (*Service, fixture) {
	t.Helper()
	f := restFixture(t)
	f.league.Board.FromWeek, f.league.Board.Refreshed = 6, restRunInstant
	change(&f)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season, s.Boards = 2026, fakeBoards{board: f.league.Board}
	s.Now = func() time.Time { return restSunday.Add(5 * time.Hour) }
	return s, f
}

// noFormatRanks fails when any format's figure carries a rank.
func noFormatRanks(t *testing.T, path string, out apitypes.PlayerWeek) {
	t.Helper()
	if out.RestOfSeason == nil {
		t.Fatalf("%s: no rest-of-season figures", path)
	}
	for _, fig := range *out.RestOfSeason {
		if fig.PositionRank != nil || fig.OverallRank != nil {
			t.Fatalf("%s: %s figure ranked %v and %v", path, fig.Format, fig.PositionRank, fig.OverallRank)
		}
	}
}

// Fix round 1, M1: on a league read a rostered player with the platform's
// IR mark and no season-long code has no number in any format, as his head
// has none; the public read, which never sees the mark, numbers him.
func TestALeagueReadGivesAHostIRPlayerNoFormatRank(t *testing.T) {
	var id string
	s, _ := restRoutesWith(t, func(f *fixture) {
		host := f.league.Snap.Teams[0].Players[1] // team 1's lead back
		read := f.league.Player
		f.league.Player = func(h string) apitypes.LeaguePlayer {
			p := read(h)
			if h == host {
				p.InjuredReserve = true
			}
			return p
		}
		id = *read(host).BoardId
	})
	league := leaguePath + "players/" + id
	out := playerWeekOf(t, s, league)
	if out.Line.PositionRank != nil {
		t.Fatalf("the league head ranks the IR back %d", *out.Line.PositionRank)
	}
	noFormatRanks(t, league, out)
	public := playerWeekOf(t, s, "/players/"+id+"/week")
	if fig := figureOf(t, public, apitypes.BoardFormatPpr); fig.PositionRank == nil || fig.OverallRank == nil {
		t.Fatal("the public read does not number him: the test proves nothing")
	}
}

// Fix round 1, M2: a league read a week behind our order (the platform has
// not rolled its week) counts the other players as the order does. A back
// due back on his club's next game day is returning this week to the order
// and still listed to the league's week; every player behind him has the
// order's number on the league read, and the league page leaves the
// returning back himself unranked, as its head does.
func TestALeagueAWeekBehindCountsOthersAsTheOrderDoes(t *testing.T) {
	var back string
	s, f := restRoutesWith(t, func(f *fixture) {
		f.league.Snap.Week = 5
		for _, p := range f.raw.Players {
			if p.Position == draft.RB && p.Team != "TEN" && p.Team != "WSH" {
				back = p.ID
				break
			}
		}
		f.data.Designations[back] = boards.Designation{Code: "IR", AsOf: restRunInstant.Add(-72 * time.Hour), ReturnOn: eastDay(time.October, 18)}
	})
	if w := nextWeek(f.data.Games); w != 6 {
		t.Fatalf("the order's week is %d, want 6", w)
	}
	order := orderOfRoute(t, s, "/order?byes=last&limit=400&position=RB")
	across := orderOfRoute(t, s, "/order?byes=last&limit=400")
	behind := []string{}
	seen := false
	for _, row := range order.Rows {
		id := *row.Line.Player.BoardId
		if id == back {
			if d := row.Line.Facts.Designation; d != nil && d.SeasonLong != nil && *d.SeasonLong {
				t.Fatal("the order lists the returning back: the test proves nothing")
			}
			seen = true
			continue
		}
		if seen && len(behind) < 5 {
			behind = append(behind, id)
		}
	}
	if len(behind) == 0 {
		t.Fatal("no back behind the returning one")
	}
	if head := playerWeekOf(t, s, leaguePath+"players/"+back); head.Line.PositionRank != nil {
		t.Fatalf("the league week still numbers the returning back %d: the test proves nothing", *head.Line.PositionRank)
	} else {
		noFormatRanks(t, leaguePath+"players/"+back, head)
	}
	for _, id := range behind {
		fig := figureOf(t, playerWeekOf(t, s, leaguePath+"players/"+id), apitypes.BoardFormatPpr)
		at, all := overallOn(t, order, id), overallOn(t, across, id)
		if fig.PositionRank == nil || fig.OverallRank == nil || *fig.PositionRank != at || *fig.OverallRank != all {
			t.Fatalf("%s: the league read's figure %v and %v, the order's %d and %d", id, fig.PositionRank, fig.OverallRank, at, all)
		}
	}
}
