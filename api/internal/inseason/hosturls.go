package inseason

import (
	"fmt"
	"net/url"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Page is a host page a verb opens.
type Page int

// The three pages (§4.1, §5.1, §6.1).
const (
	LineupPage Page = iota
	WaiversPage
	TradesPage
)

// ffpcTeams is FFPC's page of the member's teams, where each team's
// lineup, claims and trades are reached (the companion opens it too).
const ffpcTeams = "https://myffpc.com/MyTeams.aspx"

// yahooLeagues is the root of a Yahoo league's address: the league is
// /f1/{league}, a team /f1/{league}/{team}, as the league answer's own
// url elements give them (hosts/yahoo/testdata/yahoo-league-rosters.xml).
const yahooLeagues = "https://football.fantasysports.yahoo.com/f1/"

// espnLeague is an ESPN league's address, the one a member pastes to
// follow it (espn.Parse).
const espnLeague = "https://fantasy.espn.com/football/league"

// HostURL is the host's page for the verb, empty for a host whose page
// we do not know. team is the member's roster in the league (0 when
// unknown). Sleeper: the member's team page sets the lineup and starts a
// trade, the players page claims. Yahoo: the member's team page sets the
// lineup, the league's home reaches claims and trades. ESPN: the league's
// home, which every page links from. MyFantasyLeague: the league's home,
// whose server we do not know, which every page links from.
func HostURL(ref leaguesync.Ref, team int, page Page) string {
	id := url.PathEscape(ref.LeagueID)
	switch ref.Host {
	case leaguesync.HostSleeper:
		if page == WaiversPage {
			return "https://sleeper.com/leagues/" + id + "/players"
		}
		return "https://sleeper.com/leagues/" + id + "/team"
	case leaguesync.HostYahoo:
		if page == LineupPage && team > 0 {
			return fmt.Sprintf("%s%s/%d", yahooLeagues, id, team)
		}
		return yahooLeagues + id
	case leaguesync.HostESPN:
		q := url.Values{"leagueId": {ref.LeagueID}}
		if ref.Season > 0 {
			q.Set("seasonId", fmt.Sprint(ref.Season))
		}
		return espnLeague + "?" + q.Encode()
	case leaguesync.HostFFPC:
		return ffpcTeams
	case leaguesync.HostMFL:
		if ref.Season > 0 {
			return fmt.Sprintf("https://www.myfantasyleague.com/%d/home/%s", ref.Season, id)
		}
	}
	return ""
}

// HostNote is what a page says under its verb when it cannot open the
// host's page (href empty): where the member makes the change. Nil when
// the verb opens the page.
func HostNote(ref leaguesync.Ref, href string) *string {
	if href != "" {
		return nil
	}
	note := "Make this change on " + leaguesync.HostWords(ref.Host) + ". We cannot open that page for you yet."
	return &note
}
