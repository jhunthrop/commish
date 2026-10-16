package yahoo

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// The member's list: each league once, its team count, scoring type and
// the member's own team name from the teams answer.
func TestParseMyLeagues(t *testing.T) {
	list, err := ParseMyLeagues(fixture(t, "yahoo-my-leagues.xml"), fixture(t, "yahoo-my-teams.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("%d leagues, want 2", len(list))
	}
	first := list[0]
	if first.LeagueID != "128934" || first.GameKey != "470" || first.Season != 2026 || first.Teams != 10 ||
		first.ScoringType != "head" || first.TeamName != "Gridiron Gurus" || first.Name != "The Commish Classic" {
		t.Fatalf("first league: %+v", first)
	}
	if list[1].TeamName != "Desk Jockeys" || list[1].Teams != 12 {
		t.Fatalf("second league: %+v", list[1])
	}
}

func TestParseGameKey(t *testing.T) {
	key, err := ParseGameKey(fixture(t, "yahoo-games-2026.xml"), 2026)
	if err != nil || key != "470" {
		t.Fatalf("game key %q, %v", key, err)
	}
	if _, err := ParseGameKey(fixture(t, "yahoo-games-2026.xml"), 2025); !errors.Is(err, ErrNoSuchLeague) {
		t.Fatalf("a season the answer does not carry: %v", err)
	}
}

// A whole league: teams with records and rosters by slot, the member's
// team, the lineup, the scoring with its bonus, the week's games and the
// managers' moves (a commissioner's left out).
func TestParseLeague(t *testing.T) {
	l, err := ParseLeague(fixture(t, "yahoo-league-head.xml"), fixture(t, "yahoo-league-rosters.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if l.LeagueID != "128934" || l.Season != 2026 || l.CurrentWeek != 6 || l.Name != "The Commish Classic" || l.Finished {
		t.Fatalf("league: %+v", l)
	}
	if len(l.Teams) != 10 {
		t.Fatalf("%d teams", len(l.Teams))
	}
	me := l.Teams[0]
	if !me.Mine || me.ID != 1 || me.Owner != "Justin" || me.Wins != 4 || me.Losses != 2 || me.PointsFor != 702.48 {
		t.Fatalf("the member's team: %+v", me)
	}
	if l.Teams[1].Mine {
		t.Fatal("a league-mate's team read as the member's")
	}
	if len(me.Players) != 13 {
		t.Fatalf("%d players on the member's roster", len(me.Players))
	}
	allen, cmc := me.Players[0], me.Players[12]
	if allen.ID != "30977" || allen.Name != "Josh Allen" || allen.Position != "QB" || allen.Team != "BUF" || allen.Slot != "QB" {
		t.Fatalf("first player: %+v", allen)
	}
	if cmc.Slot != "IR" || !cmc.Injured {
		t.Fatalf("injured reserve: %+v", cmc)
	}
	if got := len(l.Settings.Slots); got != 9 {
		t.Fatalf("%d roster slots", got)
	}
	var rush Modifier
	for _, m := range l.Settings.Modifiers {
		if m.StatID == 9 {
			rush = m
		}
	}
	if rush.Points != 0.1 || len(rush.Bonuses) != 1 || rush.Bonuses[0].Target != 100 || rush.Bonuses[0].Points != 3 {
		t.Fatalf("rushing yards: %+v", rush)
	}
	if l.Scoreboard.Week != 6 || len(l.Scoreboard.Games) != 5 {
		t.Fatalf("scoreboard: %+v", l.Scoreboard)
	}
	if g := l.Scoreboard.Games[0]; g.TeamIDs != [2]int{1, 2} || g.Points != [2]float64{88.12, 101.4} {
		t.Fatalf("first game: %+v", g)
	}
	if len(l.Moves) != 3 {
		t.Fatalf("%d moves, want 3 (the commissioner's left out)", len(l.Moves))
	}
	waiver, add, trade := l.Moves[0], l.Moves[1], l.Moves[2]
	if waiver.Kind != MoveWaiver || waiver.Adds["34000"] != 1 || waiver.Drops["29999"] != 1 ||
		!waiver.At.Equal(time.Unix(1760300000, 0)) {
		t.Fatalf("waiver claim: %+v", waiver)
	}
	if add.Kind != MoveAdd || add.Adds["34101"] != 1 || len(add.Drops) != 0 {
		t.Fatalf("free agent add: %+v", add)
	}
	if trade.Kind != MoveTrade || trade.Adds["32706"] != 2 || trade.Drops["32706"] != 3 || trade.Adds["40031"] != 3 {
		t.Fatalf("trade: %+v", trade)
	}
}

// What is not Yahoo's XML, or a league with no teams, is refused whole.
func TestParseLeagueRefusesWhatIsNotALeague(t *testing.T) {
	if _, err := ParseLeague([]byte("<html>sign in</html>"), fixture(t, "yahoo-league-rosters.xml")); !errors.Is(err, ErrMalformed) {
		t.Fatalf("html: %v", err)
	}
	empty := []byte(`<fantasy_content><league><league_id>1</league_id><teams count="0"></teams></league></fantasy_content>`)
	if _, err := ParseLeague(fixture(t, "yahoo-league-head.xml"), empty); !errors.Is(err, ErrMalformed) {
		t.Fatalf("no teams: %v", err)
	}
}

func TestLeagueKeyChecksItsParts(t *testing.T) {
	if k, err := LeagueKey("470", "128934"); err != nil || k != "470.l.128934" {
		t.Fatalf("%q %v", k, err)
	}
	if k, err := LeagueKey(currentGame, "128934"); err != nil || k != "nfl.l.128934" {
		t.Fatalf("the current game: %q %v", k, err)
	}
	for _, bad := range [][2]string{{"470/../x", "1"}, {"470", "1;out=x"}, {"", "1"}, {"470", ""}} {
		if _, err := LeagueKey(bad[0], bad[1]); err == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
}

// H1: a league past its draft whose rosters answer carries no player on
// any roster (a shape we do not read) fails the read with a reason, never
// an empty league whose every player reads as free.
func TestParseLeagueRefusesADraftedLeagueWithNoRosters(t *testing.T) {
	bare := []byte(`<fantasy_content><league><league_id>128934</league_id><teams count="2">` +
		`<team><team_key>470.l.128934.t.1</team_key><team_id>1</team_id><name>A</name></team>` +
		`<team><team_key>470.l.128934.t.2</team_key><team_id>2</team_id><name>B</name></team>` +
		`</teams></league></fantasy_content>`)
	_, err := ParseLeague(fixture(t, "yahoo-league-head.xml"), bare)
	if !errors.Is(err, ErrMalformed) || !strings.Contains(err.Error(), "no player on any roster") {
		t.Fatalf("a drafted league with no rosters: %v", err)
	}
	predraft := strings.Replace(string(fixture(t, "yahoo-league-head.xml")), "<draft_status>postdraft</draft_status>", "<draft_status>predraft</draft_status>", 1)
	if _, err := ParseLeague([]byte(predraft), bare); err != nil {
		t.Fatalf("a league before its draft has empty rosters: %v", err)
	}
}

// The waiver wire: each player on waivers and the day his claim clears.
func TestParseWaivers(t *testing.T) {
	list, n, err := ParseWaivers(fixture(t, "yahoo-league-waivers.xml"))
	if err != nil || n != 3 || len(list) != 3 {
		t.Fatalf("%d of %d, %v", len(list), n, err)
	}
	if list[0].Player.ID != "29999" || list[0].Until != "2026-10-16" || list[2].Until != "" || list[1].Player.Team != "JAX" {
		t.Fatalf("%+v", list)
	}
	if _, _, err := ParseWaivers([]byte("<html>")); !errors.Is(err, ErrMalformed) {
		t.Fatalf("not xml: %v", err)
	}
}

// L8: no answer, however malformed, makes a parser panic.
func FuzzParseLeague(f *testing.F) {
	head, err := os.ReadFile(filepath.Join("testdata", "yahoo-league-head.xml"))
	if err != nil {
		f.Fatal(err)
	}
	rosters, err := os.ReadFile(filepath.Join("testdata", "yahoo-league-rosters.xml"))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(head, rosters)
	f.Add([]byte("<fantasy_content><league><league_id>1</league_id></league></fantasy_content>"), []byte("<x/>"))
	f.Fuzz(func(t *testing.T, head, rosters []byte) {
		l, err := ParseLeague(head, rosters)
		if err == nil {
			_ = l.Settings.Scoring()
		}
		_, _, _ = ParseWaivers(rosters)
	})
}

func FuzzParseMyLeagues(f *testing.F) {
	leagues, err := os.ReadFile(filepath.Join("testdata", "yahoo-my-leagues.xml"))
	if err != nil {
		f.Fatal(err)
	}
	teams, err := os.ReadFile(filepath.Join("testdata", "yahoo-my-teams.xml"))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(leagues, teams)
	f.Fuzz(func(t *testing.T, leagues, teams []byte) {
		_, _ = ParseMyLeagues(leagues, teams)
	})
}

// The league's draft time (settings draft_time, Unix seconds) and its
// playoff start week (settings playoff_start_week, when uses_playoff is
// 1), on a drafted league and on the constructed pre-draft one.
func TestParseLeagueCalendar(t *testing.T) {
	l, err := ParseLeague(fixture(t, "yahoo-league-head.xml"), fixture(t, "yahoo-league-rosters.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if l.DraftAt == nil || !l.DraftAt.Equal(time.Date(2026, 8, 30, 23, 0, 0, 0, time.UTC)) || l.PlayoffStartWeek != 15 || l.DraftStatus != "postdraft" {
		t.Fatalf("drafted: draft at %v, playoffs from %d, %s", l.DraftAt, l.PlayoffStartWeek, l.DraftStatus)
	}
	empty := []byte(`<fantasy_content><league><league_id>128934</league_id><teams count="1">` +
		`<team><team_key>470.l.128934.t.1</team_key><team_id>1</team_id><name>A</name></team></teams></league></fantasy_content>`)
	pre, err := ParseLeague(fixture(t, "yahoo-league-head-predraft.xml"), empty)
	if err != nil {
		t.Fatal(err)
	}
	if pre.DraftStatus != "predraft" || pre.DraftAt == nil || !pre.DraftAt.Equal(time.Date(2026, 9, 6, 23, 0, 0, 0, time.UTC)) || pre.CurrentWeek != 1 {
		t.Fatalf("pre-draft: %s at %v week %d", pre.DraftStatus, pre.DraftAt, pre.CurrentWeek)
	}
	none := strings.NewReplacer("<draft_time>1788130800</draft_time>", "", "<uses_playoff>1</uses_playoff>", "<uses_playoff>0</uses_playoff>").
		Replace(string(fixture(t, "yahoo-league-head.xml")))
	l, err = ParseLeague([]byte(none), fixture(t, "yahoo-league-rosters.xml"))
	if err != nil || l.DraftAt != nil || l.PlayoffStartWeek != 0 {
		t.Fatalf("no draft time and no playoffs: %v %d (%v)", l.DraftAt, l.PlayoffStartWeek, err)
	}
}
