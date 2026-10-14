package ffpc

// PageName is one league page the client reads, keyed by the member's
// league-team id (ltuid) in its address.
type PageName string

// The league pages read, each a plain GET keyed by ltuid.
const (
	PageLeagueHome  PageName = "league_home"
	PageStandings   PageName = "standings"
	PageRosters     PageName = "rosters"
	PageLineup      PageName = "lineup"
	PageSchedule    PageName = "schedule"
	PageOwners      PageName = "owners"
	PageRules       PageName = "rules"
	PageFreeAgents  PageName = "free_agents"
	PageDraftBoard  PageName = "draft_board"
	PageDraftReport PageName = "draft_report"
	PageScoreboard  PageName = "scoreboard"
)

var pagePaths = map[PageName]string{
	PageLeagueHome:  "/LeagueHome.aspx",
	PageStandings:   "/Standings.aspx",
	PageRosters:     "/Rosters.aspx",
	PageLineup:      "/SetLineup.aspx",
	PageSchedule:    "/Schedule.aspx",
	PageOwners:      "/Owners.aspx",
	PageRules:       "/leagueRulesFFPC.aspx",
	PageFreeAgents:  "/FreeAgents.aspx",
	PageDraftBoard:  "/DraftBoard.aspx",
	PageDraftReport: "/DraftReportCard.aspx",
	PageScoreboard:  "/Scoreboard.aspx",
}
