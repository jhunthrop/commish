package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Every host the site follows answers a page. Yahoo's shapes are the
// league and team addresses its league answer carries
// (hosts/yahoo/testdata/yahoo-league-rosters.xml), ESPN's the league
// address a member pastes to follow (espn.Parse, leaguesync/espn_test.go).
func TestHostURL(t *testing.T) {
	yahoo := leaguesync.Ref{Host: leaguesync.HostYahoo, LeagueID: "128934", Season: 2026}
	espn := leaguesync.Ref{Host: leaguesync.HostESPN, LeagueID: "48153503", Season: 2019}
	sleeper := leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: "1382163311038038016"}
	mfl := leaguesync.Ref{Host: leaguesync.HostMFL, LeagueID: "12345", Season: 2026}
	cases := []struct {
		ref  leaguesync.Ref
		team int
		page Page
		want string
	}{
		{yahoo, 1, LineupPage, "https://football.fantasysports.yahoo.com/f1/128934/1"},
		{yahoo, 0, LineupPage, "https://football.fantasysports.yahoo.com/f1/128934"},
		{yahoo, 1, WaiversPage, "https://football.fantasysports.yahoo.com/f1/128934"},
		{yahoo, 1, TradesPage, "https://football.fantasysports.yahoo.com/f1/128934"},
		{espn, 3, LineupPage, "https://fantasy.espn.com/football/league?leagueId=48153503&seasonId=2019"},
		{espn, 3, TradesPage, "https://fantasy.espn.com/football/league?leagueId=48153503&seasonId=2019"},
		{leaguesync.Ref{Host: leaguesync.HostESPN, LeagueID: "7"}, 1, WaiversPage, "https://fantasy.espn.com/football/league?leagueId=7"},
		{sleeper, 1, LineupPage, "https://sleeper.com/leagues/1382163311038038016/team"},
		{sleeper, 1, WaiversPage, "https://sleeper.com/leagues/1382163311038038016/players"},
		{leaguesync.Ref{Host: leaguesync.HostFFPC, LeagueID: "9"}, 1, TradesPage, ffpcTeams},
		{mfl, 1, LineupPage, "https://www.myfantasyleague.com/2026/home/12345"},
		{leaguesync.Ref{Host: leaguesync.HostMFL, LeagueID: "12345"}, 1, LineupPage, ""},
	}
	for _, c := range cases {
		if got := HostURL(c.ref, c.team, c.page); got != c.want {
			t.Errorf("%s %d page %d: got %q, want %q", c.ref.Host, c.team, c.page, got, c.want)
		}
	}
}

// A host page we cannot open says where the change is made, once, and a
// page we can open says nothing.
func TestHostNote(t *testing.T) {
	if got := HostNote(leaguesync.Ref{Host: leaguesync.HostMFL, LeagueID: "12345"}, ""); got == nil ||
		*got != "Make this change on MyFantasyLeague. We cannot open that page for you yet." {
		t.Fatalf("note %v", got)
	}
	if got := HostNote(leaguesync.Ref{Host: leaguesync.HostYahoo, LeagueID: "1"}, "https://football.fantasysports.yahoo.com/f1/1"); got != nil {
		t.Fatalf("a page we open carries a note: %q", *got)
	}
	guard(t, *HostNote(leaguesync.Ref{Host: leaguesync.HostESPN}, ""))
}
