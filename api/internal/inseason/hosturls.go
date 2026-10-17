package inseason

import (
	"fmt"
	"net/url"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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

// copyLineupWords is the line under "Copy the lineup" where the platform
// takes no lineup from our screen.
const copyLineupWords = "%s does not take lineups from here, so copy the lineup there."

// CopyOnlyMoves is the lineup verb where the platform takes no lineup from
// here, or no moves are wired: copy the lineup, with the line that says
// why, the platform named.
func CopyOnlyMoves(host string) apitypes.LineupMoves {
	reason := fmt.Sprintf(copyLineupWords, leaguesync.HostWords(host))
	return apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, Reason: &reason}
}

// copyClaimWords is the line under the waiver page verb where the platform
// takes no claim from our screen.
const copyClaimWords = "%s does not take claims from here, so add him on its waiver page."

// ClaimsOffWords is the line under the waiver page verb where the
// platform takes claims from here but not for this member now (ESPN with
// its claim switch off, or a check that failed).
const ClaimsOffWords = "Claims are not sent to ESPN from here yet, so add him on ESPN's waiver page."

// CopyOnlyClaims is the waiver verb where the claim is not made from here:
// the platform's waiver page, with the line that says why, the platform
// named (Lane 66f). ESPN takes claims, so its line says they are not sent
// from here yet rather than that ESPN takes none (review 66f M2).
func CopyOnlyClaims(host string) apitypes.WaiverMoves {
	reason := fmt.Sprintf(copyClaimWords, leaguesync.HostWords(host))
	if host == leaguesync.HostESPN {
		reason = ClaimsOffWords
	}
	return apitypes.WaiverMoves{Claim: apitypes.WaiverMovesClaimUnavailable, Reason: &reason}
}

// proposeWords is the line under the trade verb: no platform takes a
// trade proposal from our screen yet (Lane 66g).
const proposeWords = "%s does not take trade proposals from here, so we copy the trade for you to propose there."

// TradeMoves is the trade verb's rule, the lineup verb's twin: Propose
// on the platform where it takes proposals from here (none today), else
// the offer copied and the platform's trade page opened, with the line
// that says why, the platform named.
func TradeMoves(host string) apitypes.TradeMoves {
	reason := fmt.Sprintf(proposeWords, leaguesync.HostWords(host))
	return apitypes.TradeMoves{Propose: apitypes.TradeMovesProposeUnavailable, Reason: &reason}
}

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
