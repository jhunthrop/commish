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

// HostURL is the host's page for the verb, empty for a host whose page
// we do not know. Sleeper: the member's team page sets the lineup and
// starts a trade, the players page claims. MyFantasyLeague: the league's
// home, whose server we do not know, which every page links from.
func HostURL(ref leaguesync.Ref, page Page) string {
	id := url.PathEscape(ref.LeagueID)
	switch ref.Host {
	case leaguesync.HostSleeper:
		if page == WaiversPage {
			return "https://sleeper.com/leagues/" + id + "/players"
		}
		return "https://sleeper.com/leagues/" + id + "/team"
	case leaguesync.HostFFPC:
		return ffpcTeams
	case leaguesync.HostMFL:
		if ref.Season > 0 {
			return fmt.Sprintf("https://www.myfantasyleague.com/%d/home/%s", ref.Season, id)
		}
	}
	return ""
}
