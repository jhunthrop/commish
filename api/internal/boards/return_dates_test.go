package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/season"
)

// A return date reads strictly (Lane 110, B79): the same status in the
// player list's words, a real YYYYMMDD day, no earlier than the list's own
// Eastern day. Anything else is no date, never a guess.
func TestReturnOnOf(t *testing.T) {
	east := season.Eastern()
	listed := time.Date(2026, 10, 13, 15, 0, 0, 0, time.UTC) // Tuesday 11:00 Eastern
	for _, tc := range []struct {
		name, code, date, status string
		want                     time.Time
	}{
		{"injured reserve", "Injured Reserve", "20261025", StatusInjuredReserve, time.Date(2026, 10, 25, 0, 0, 0, 0, east)},
		{"designated to return", "Injured Reserve - Designated to Return", "20261018", StatusInjuredReserve, time.Date(2026, 10, 18, 0, 0, 0, 0, east)},
		{"the list's own day", "Out", "20261013", StatusOut, time.Date(2026, 10, 13, 0, 0, 0, 0, east)},
		{"a date already passed", "Injured Reserve", "20261012", StatusInjuredReserve, time.Time{}},
		{"another status on the list", "Out", "20261015", StatusQuestionable, time.Time{}},
		{"words we do not know", "Reserve-Ret", "20270215", StatusInjuredReserve, time.Time{}},
		{"no date", "Injured Reserve", "", StatusInjuredReserve, time.Time{}},
		{"not a day", "Injured Reserve", "20261399", StatusInjuredReserve, time.Time{}},
		{"not the layout", "Injured Reserve", "2026-10-25", StatusInjuredReserve, time.Time{}},
		{"letters", "Injured Reserve", "2026102x", StatusInjuredReserve, time.Time{}},
		{"no status", "", "20261025", "", time.Time{}},
	} {
		got, ok := ReturnOnOf(tc.code, tc.date, tc.status, listed)
		if ok != !tc.want.IsZero() || !got.Equal(tc.want) {
			t.Errorf("%s: %v %v, want %v", tc.name, got, ok, tc.want)
		}
	}
}

func returnDatesSchema(t *testing.T, schema string, rows string) *PGSource {
	t.Helper()
	pool := dbtest.Pool(t)
	ctx := context.Background()
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "IR"}, {"playerID": "p2", "designation": "O"},
				{"playerID": "p3", "designation": "IR"}, {"playerID": "p4", "designation": "Q"}, {"playerID": "p5", "designation": "IR"}]}',
				'2026-10-13 10:00:00+00')`,
		`insert into ` + schema + `.capture_snapshots values ` + rows,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	return src
}

// The newest player list near the designations' list dates each one it
// names under the same status; the rest stay undated.
func TestDesignationsCarryThePlayerListsReturnDates(t *testing.T) {
	src := returnDatesSchema(t, "return_dates_test", `
		('tank01_player_list', '[{"playerID": "p1", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261101"}}]', '2026-10-12 09:00:00+00'),
		('tank01_player_list', '[
			{"playerID": "p1", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261025"}},
			{"playerID": "p2", "injury": {"designation": "Out", "injReturnDate": ""}},
			{"playerID": "p3", "injury": {"designation": "Injured Reserve - Designated to Return", "injReturnDate": "20261018"}},
			{"playerID": "p4", "injury": {"designation": "Out", "injReturnDate": "20261015"}},
			{"playerID": "p5", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261012"}},
			{"playerID": "p9", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261025"}},
			{"playerID": "p6", "injury": "none"}, 7]', '2026-10-13 11:00:00+00'),
		('tank01_player_list', '[{"playerID": "p1", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261108"}}]', '2026-10-16 11:00:00+00')`)
	d, err := src.Designations(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	east := season.Eastern()
	want := map[string]*time.Time{"p1": ptr(time.Date(2026, 10, 25, 0, 0, 0, 0, east)), "p3": ptr(time.Date(2026, 10, 18, 0, 0, 0, 0, east))}
	for _, id := range []string{"p1", "p2", "p3", "p4", "p5"} {
		got, ok := d[id]
		if !ok {
			t.Fatalf("%s lost his designation: %+v", id, d)
		}
		if w := want[id]; (w == nil) != (got.ReturnOn == nil) || (w != nil && !got.ReturnOn.Equal(*w)) {
			t.Errorf("%s returns %v, want %v", id, got.ReturnOn, w)
		}
	}
}

// A player list older than the window, or that is not a list, dates
// nobody and never costs the designations.
func TestAPlayerListOutOfReachDatesNobody(t *testing.T) {
	for name, rows := range map[string]string{
		"too old":    `('tank01_player_list', '[{"playerID": "p1", "injury": {"designation": "Injured Reserve", "injReturnDate": "20261025"}}]', '2026-10-11 09:00:00+00')`,
		"not a list": `('tank01_player_list', '{"playerID": "p1"}', '2026-10-13 11:00:00+00')`,
	} {
		src := returnDatesSchema(t, "return_dates_reach_test", rows)
		d, err := src.Designations(context.Background())
		if err != nil || len(d) != 5 {
			t.Fatalf("%s: designations %v (%v), want the five listed", name, d, err)
		}
		for id, got := range d {
			if got.ReturnOn != nil {
				t.Errorf("%s: %s returns %v, want no date", name, id, got.ReturnOn)
			}
		}
	}
}

func ptr[T any](v T) *T { return &v }

// The schedule reads leave a game the ingest marked superseded out
// (research revision 0016, B77b), and read a table without the column as
// before (the api ahead of the migration).
func TestSupersededGamesAreNotGamesToPlay(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "superseded_games_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.provider_games (season int, week int, home_team text, away_team text, game_date date,
			kickoff_et text, superseded_by text)`,
		// Week 18's BAL at PIT moved from Sunday to Saturday under a new id.
		`insert into ` + schema + `.provider_games values
			(2026, 18, 'PIT', 'BAL', '2027-01-10', '1:00p', '20270109_BAL@PIT'),
			(2026, 18, 'PIT', 'BAL', '2027-01-09', '4:30p', null),
			(2026, 18, 'NYG', 'DAL', '2027-01-09', '8:00p', null)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	last, ok, err := src.LastGameDay(ctx, 2026)
	if err != nil || !ok || last.Day() != 9 {
		t.Fatalf("the last game day %v %v (%v), want Saturday Jan 9: the moved game's Sunday is not a game", last, ok, err)
	}
	sunday := time.Date(2027, 1, 10, 18, 0, 0, 0, time.UTC)
	if week, ok, err := src.WeekAt(ctx, 2026, sunday); err != nil || ok {
		t.Fatalf("Sunday Jan 10 is week %d %v (%v), want past the season", week, ok, err)
	}
	if _, err := pool.Exec(ctx, `alter table `+schema+`.provider_games drop column superseded_by`); err != nil {
		t.Fatal(err)
	}
	if week, ok, err := src.WeekAt(ctx, 2026, sunday); err != nil || !ok || week != 18 {
		t.Fatalf("without the column every row is a game, as before: week %d %v (%v)", week, ok, err)
	}
}
