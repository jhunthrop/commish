package leaguerecord

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// fakeWeeks answers a member read for the connected account and a public
// read for league 2 alone; league 3 is private and its member is not
// connected, so it fails.
type fakeWeeks struct {
	member uuid.UUID
	asked  []string
}

func week7() espn.WeekRead {
	return espn.WeekRead{Season: 2026, Period: 7, ScoringPeriod: 7, Teams: []espn.WeekTeam{{ID: 3, Players: []espn.WeekPlayer{
		{ID: "3116593", Position: "RB", Team: "MIN", Slot: 2, Status: "ACTIVE", Points: map[int]espn.PeriodPoints{
			7: {Projected: f(19.6)}, 6: {Projected: f(20.93), Actual: f(13)},
		}},
	}}}}
}

func (w *fakeWeeks) ReadWeek(_ context.Context, ref leaguesync.Ref, period int) (espn.WeekRead, error) {
	w.asked = append(w.asked, ref.LeagueID)
	if (ref.LeagueID == "1" && ref.As == w.member) || ref.LeagueID == "2" {
		return week7(), nil
	}
	return espn.WeekRead{}, fmt.Errorf("%w: not a league of this member", espn.ErrPrivate)
}

// Every attached ESPN league is read once, as a connected member who
// attached it to read as themselves where there is one; each read is kept
// whole, the period asked and the one before it, and read back in order.
func TestCaptureKeepsEveryAttachedESPNLeaguesRead(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	var member, other uuid.UUID
	for name, into := range map[string]*uuid.UUID{"lane93_member": &member, "lane93_other": &other} {
		if err := pool.QueryRow(ctx, `insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.invalid') returning id`,
			name).Scan(into); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `insert into app.host_connections
		(account_id, host, wrapped_key, session_ct, signin_ct, key_version, consented_at, consent_version)
		values ($1, 'espn', decode(repeat('00', 40), 'hex'), decode(repeat('00', 16), 'hex'), decode(repeat('00', 16), 'hex'), 1, now(), 3)`,
		member); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into app.league_links (account_id, host, host_league_id, host_season, roster_id, read_as_member, detached_at)
		values ($2, 'espn', '1', 2026, 4, false, null), ($1, 'espn', '1', 2026, 3, true, null),
		       ($2, 'espn', '2', 2026, 1, false, null), ($2, 'espn', '3', 2026, 1, true, null),
		       ($2, 'espn', '4', 2026, 1, false, now()), ($1, 'sleeper', '5', 0, 1, false, null), ($1, 'espn', '6', 2025, 1, true, null)`, member, other); err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	refs, err := store.Leagues(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 || refs[0].As != member || refs[1].As != uuid.Nil || refs[2].As != uuid.Nil {
		t.Fatalf("leagues %+v", refs)
	}
	at := time.Date(2026, 10, 22, 17, 30, 0, 0, time.UTC)
	reader := &fakeWeeks{member: member}
	got, err := Capture(ctx, store, reader, 2026, []int{7}, at, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if got != (Captured{Leagues: 3, Read: 2, Skipped: 1, Rows: 4}) {
		t.Fatalf("captured %+v", got)
	}
	rows, err := store.Reads(ctx, "1", 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Week != 6 || rows[1].Week != 7 || !rows[1].ReadAt.Equal(at) || rows[1].ReadPeriod != 7 {
		t.Fatalf("rows %+v", rows)
	}
	if r := rows[0]; r.Actual == nil || *r.Actual != 13 || r.TeamID != 3 || r.ProTeam != "MIN" || r.Status != "ACTIVE" {
		t.Errorf("week 6 row %+v", r)
	}
	if r := rows[1]; r.Projected == nil || *r.Projected != 19.6 || r.Actual != nil {
		t.Errorf("week 7 row %+v", r)
	}
}

// A member read ESPN refuses falls back to the public read.
func TestESPNWeeksFallsBackToThePublicRead(t *testing.T) {
	w := ESPNWeeks{Member: refusingMember{}, Public: publicWeeks{}, Log: quiet}
	got, err := w.ReadWeek(context.Background(), leaguesync.Ref{Host: leaguesync.HostESPN, LeagueID: "2", Season: 2026, As: uuid.New()}, 7)
	if err != nil || got.Period != 7 {
		t.Fatalf("%+v %v", got, err)
	}
}

type refusingMember struct{}

func (refusingMember) ReadWeek(context.Context, uuid.UUID, string, int, int) (espn.WeekRead, error) {
	return espn.WeekRead{}, espn.ErrSignedOut
}

type publicWeeks struct{}

func (publicWeeks) ReadWeek(_ context.Context, _ string, _, period int, cookies *espn.Cookies) (espn.WeekRead, error) {
	if cookies != nil {
		return espn.WeekRead{}, errors.New("a public read sends no cookies")
	}
	return espn.WeekRead{Season: 2026, Period: period}, nil
}

type fakeOrders struct{ orders []boards.SetOrder }

func (f fakeOrders) SetOrders(context.Context, int) ([]boards.SetOrder, error) { return f.orders, nil }

// The roster as one read of period 7 carries it, with or without points.
func rosterRead(points bool) espn.WeekRead {
	team := espn.WeekTeam{ID: 3}
	for _, r := range roster {
		p := espn.PeriodPoints{Projected: f(r.projected)}
		if points {
			p.Actual = f(r.actual)
		}
		slot, ok := memberSet[r.id]
		if !ok {
			slot = espn.SlotBench
		}
		team.Players = append(team.Players, espn.WeekPlayer{ID: r.id, Position: r.position, Team: r.team, Slot: slot, Status: r.status,
			Points: map[int]espn.PeriodPoints{7: p}})
	}
	return espn.WeekRead{Season: 2026, Period: 7, ScoringPeriod: 7, Teams: []espn.WeekTeam{team}}
}

// Review L3: the service end to end, through the store: an ESPN league's
// team graded from the kept reads and the set orders; another platform's
// league, or no team of the member's, has no week.
func TestServiceGradesAnESPNLeagueFromItsKeptReads(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	store := &Store{Pool: pool}
	for _, put := range []struct {
		at     time.Time
		points bool
	}{{readAt, false}, {after, true}} {
		if _, err := store.Put(ctx, "1", rosterRead(put.points), put.at); err != nil {
			t.Fatal(err)
		}
	}
	svc := &Service{Store: store, Orders: fakeOrders{[]boards.SetOrder{order(&gradedAt)}}}
	snap := leaguesync.Snapshot{Ref: leaguesync.Ref{Host: leaguesync.HostESPN, LeagueID: "1", Season: 2026}, Shape: espnShape}
	got, err := svc.Weeks(ctx, snap, 3, byes)
	// Lane 114: the week's ranking over the league's rostered players rides along.
	if err == nil && (len(got) != 1 || got[0].Ranking == nil || got[0].Ranking.Players == 0) {
		t.Fatalf("no ranking: %+v", got)
	}
	if err == nil {
		got[0].Ranking = nil
	}
	// Lane 292: the member's set lineup, through the store's kept slots.
	want := []Week{{Week: 7, Benchmark: BenchmarkESPN, Ours: 97, Theirs: 70, Margin: 27, Set: &SetLineup{Points: 87}}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v %v", got, err)
	}
	sleeper := snap
	sleeper.Ref.Host = leaguesync.HostSleeper
	for _, tc := range []struct {
		snap leaguesync.Snapshot
		me   int
	}{{sleeper, 3}, {snap, 0}} {
		if got, err := svc.Weeks(ctx, tc.snap, tc.me, byes); err != nil || got != nil {
			t.Errorf("%s team %d: %+v %v", tc.snap.Ref.Host, tc.me, got, err)
		}
	}
}
