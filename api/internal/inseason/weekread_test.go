package inseason

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/weekreads"
)

// fakeWeekReads answers one stored read per player id, and records the
// week each was asked for.
type fakeWeekReads struct {
	rows  map[string]*weekreads.Row
	asked []int
}

func (f *fakeWeekReads) Read(_ context.Context, playerID string, _, week int) *weekreads.Row {
	f.asked = append(f.asked, week)
	return f.rows[playerID]
}

func refOf[T any](v T) *T { return &v }

// The Wednesday 10:00 rewrite after his status changed (Lane 284): the
// run carries the night's read until the next nightly, the card's answer
// the store's newest.
var rewrite = weekreads.Row{
	Week: 6, Body: "  Start him: the Jets give up 5.1 yards a carry.\n", Call: refOf("start"), Status: refOf("questionable"),
	WrittenAt: time.Date(2026, 10, 15, 14, 0, 0, 0, time.UTC), FactsAt: refOf(time.Date(2026, 10, 15, 13, 30, 0, 0, time.UTC)),
	// The cents, then the tenth (research capsules/page_figures.py projection_tenth): 14.25, 14.3.
	Projection: refOf(14.249),
}

func TestTheCaptionSaysTheWriteInCentral(t *testing.T) {
	for _, c := range []struct {
		at   time.Time
		want string
	}{
		{time.Date(2026, 10, 15, 14, 0, 0, 0, time.UTC), "Written Thu Oct 15, 9:00 am CT, for week 6"},
		{time.Date(2026, 10, 17, 18, 12, 24, 0, time.UTC), "Written Sat Oct 17, 1:12 pm CT, for week 6"},
		{time.Date(2026, 11, 2, 5, 5, 0, 0, time.UTC), "Written Sun Nov 1, 11:05 pm CT, for week 6"},
		{time.Date(2026, 11, 2, 6, 0, 0, 0, time.UTC), "Written Mon Nov 2, 12:00 am CT, for week 6"},
	} {
		if got := writtenCaption(c.at, 6); got != c.want {
			t.Errorf("%s: %q, want %q", c.at, got, c.want)
		}
	}
}

func TestAStoredReadIsCarriedAsTheRunCarriesIt(t *testing.T) {
	got := wireWeekRead(rewrite)
	if got.Body != "Start him: the Jets give up 5.1 yards a carry." || got.Caption != "Written Thu Oct 15, 9:00 am CT, for week 6" {
		t.Fatalf("body %q caption %q", got.Body, got.Caption)
	}
	if got.Call == nil || *got.Call != apitypes.PlayerWeekReadCallStart || got.Status == nil || *got.Status != "questionable" {
		t.Fatalf("call %v status %v", got.Call, got.Status)
	}
	if got.Projection == nil || *got.Projection != 14.3 || got.Source != apitypes.PlayerWeekReadSourceLlm || got.FactsAt == nil {
		t.Fatalf("projection %v source %q facts %v", got.Projection, got.Source, got.FactsAt)
	}
	bare := wireWeekRead(weekreads.Row{Week: 6, Body: "x", WrittenAt: rewrite.WrittenAt})
	if bare.Call != nil || bare.Status != nil || bare.Projection != nil || bare.FactsAt != nil {
		t.Fatalf("a read with none of them: %+v", bare)
	}
}

// Both player reads carry the board week's stored read, the league read
// whatever week the league is in; a store with none, or no store at all,
// leaves the field out.
func TestBothPlayerReadsCarryTheStoredRead(t *testing.T) {
	f := newFixture(t)
	bp := f.raw.Players[0]
	reads := &fakeWeekReads{rows: map[string]*weekreads.Row{bp.ID: &rewrite}}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Season = 2026
	s.Facts = fakeFacts{data: f.data, projection: boards.WeekProjection{}}
	s.Boards = fakeBoards{board: f.league.Board}
	public := playerWeekOf(t, s, "/players/"+bp.ID+"/week")
	if public.WeekRead != nil {
		t.Fatalf("no store, no read: %+v", public.WeekRead)
	}
	s.WeekReads = reads
	public = playerWeekOf(t, s, "/players/"+bp.ID+"/week")
	if public.WeekRead == nil || public.WeekRead.WrittenAt != rewrite.WrittenAt || public.WeekRead.Week != 6 {
		t.Fatalf("the public read: %+v", public.WeekRead)
	}
	league := playerWeekOf(t, s, leaguePath+"players/"+bp.ID)
	if league.WeekRead == nil || league.WeekRead.Caption != public.WeekRead.Caption {
		t.Fatalf("the league read: %+v", league.WeekRead)
	}
	for _, week := range reads.asked {
		if week != nextWeek(f.data.Games) {
			t.Fatalf("asked for week %d, the board week is %d", week, nextWeek(f.data.Games))
		}
	}
	if other := playerWeekOf(t, s, "/players/p015/week"); other.WeekRead != nil {
		t.Fatalf("none stored for him: %+v", other.WeekRead)
	}
}

// Once his game of the board week has kicked off the run serves no read
// for it, and neither does the answer.
func TestNoLiveReadOnceHisGameHasKickedOff(t *testing.T) {
	week := 6
	games := []boards.TeamWeek{
		{Week: week, Team: "NYJ", Kickoff: time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)},
		{Week: week, Team: "BUF", Kickoff: time.Date(2026, 10, 18, 20, 25, 0, 0, time.UTC)},
	}
	s := &Service{Season: 2026, WeekReads: &fakeWeekReads{rows: map[string]*weekreads.Row{"p1": &rewrite}}}
	bp := boards.Player{ID: "p1", Team: "NYJ"}
	before := time.Date(2026, 10, 18, 16, 59, 0, 0, time.UTC)
	if s.liveWeekRead(context.Background(), games, bp, before) == nil {
		t.Fatal("before kickoff the read is served")
	}
	for _, at := range []time.Time{games[0].Kickoff, games[0].Kickoff.Add(time.Hour)} {
		if got := s.liveWeekRead(context.Background(), games, bp, at); got != nil {
			t.Fatalf("at %s: %+v", at, got)
		}
	}
	if s.liveWeekRead(context.Background(), games, boards.Player{ID: "p1", Team: "BUF"}, games[0].Kickoff) == nil {
		t.Fatal("another club's kickoff leaves his read standing")
	}
}
