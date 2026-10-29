package leaguesync

import (
	"net/url"
	"slices"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Waiver kinds, as the contract (LeagueTerms.waivers) spells them.
const (
	WaiversBudget = "budget"
	WaiversOrder  = "order"
)

// How an order league's waiver order moves, as the contract
// (LeagueTerms.waiver_order) spells it: rolling, a claim sends the team to
// the back; inverse standings, the order resets each week worst first.
const (
	OrderRolling          = string(apitypes.WaiverOrderRolling)
	OrderInverseStandings = string(apitypes.WaiverOrderInverseStandings)
)

// The rule a tie in the standings is broken by, as the contract
// (LeagueTerms.tiebreak) spells it.
const (
	TiebreakHeadToHead     = string(apitypes.TiebreakHeadToHead)
	TiebreakPointsFor      = string(apitypes.TiebreakPointsFor)
	TiebreakPointsAgainst  = string(apitypes.TiebreakPointsAgainst)
	TiebreakDivisionRecord = string(apitypes.TiebreakDivisionRecord)
)

// Terms is the host's word on a league's waivers and playoffs. A zero
// field is one the host does not say.
type Terms struct {
	Waivers string `json:"waivers,omitempty"`
	// WaiverOrder is how an order league's order moves (OrderRolling or
	// OrderInverseStandings); empty in a budget league or where the host
	// does not say.
	WaiverOrder string `json:"waiver_order,omitempty"`
	// Tiebreak is the rule the host breaks a tie in the standings by
	// (TiebreakHeadToHead and the like); empty where it does not say.
	Tiebreak     string `json:"tiebreak,omitempty"`
	Budget       int    `json:"budget,omitempty"`
	PlayoffTeams int    `json:"playoff_teams,omitempty"`
	// PlayoffFirst and PlayoffLast are the playoffs' first and last week.
	PlayoffFirst int `json:"playoff_first,omitempty"`
	PlayoffLast  int `json:"playoff_last,omitempty"`
	// FinalWeeks is how many weeks the championship round runs: 2 for a
	// two-week final, 1 for one week, 0 when the host does not say.
	FinalWeeks int `json:"final_weeks,omitempty"`
	// Seeds is how the host's rules seed the playoffs, seed by seed
	// (SeedRecord or SeedPoints); none where the host states no seeding.
	Seeds []string `json:"seeds,omitempty"`
	// MedianGame says every team also plays the week's median score each
	// week (Sleeper's league_average_match, Lane 298).
	MedianGame bool `json:"median_game,omitempty"`
	// DivisionsRead says the platform's read states the league's divisions
	// (Lane 298 fix round 1); Divisions is how many it has (0 or 1 for a
	// league with none), each team's Team.Division. DivisionWinners says
	// the platform's rules seat each division's winner, as read; no read
	// states it today, so a league of several divisions draws no proof.
	DivisionsRead   bool `json:"divisions_read,omitempty"`
	Divisions       int  `json:"divisions,omitempty"`
	DivisionWinners bool `json:"division_winners,omitempty"`
	// StartWeek is the league's first week where the platform states it,
	// 0 for week 1 (Sleeper's start_week, Yahoo's start_week).
	StartWeek int `json:"start_week,omitempty"`
}

// How a playoff seed is earned, as the contract (LeagueTerms.playoff_seeds)
// spells it.
const (
	SeedRecord = string(apitypes.LeagueTermsPlayoffSeedsRecord)
	SeedPoints = string(apitypes.LeagueTermsPlayoffSeedsPoints)
)

// sleeperAvatars is where Sleeper serves a member's avatar by its id.
const sleeperAvatars = "https://sleepercdn.com/avatars/thumbs/"

// sleeperAvatar is the avatar's address, empty for none.
func sleeperAvatar(id string) string {
	if id == "" {
		return ""
	}
	return sleeperAvatars + id
}

// sleeperStreak is Sleeper's "3W" as "W3", empty for none.
func sleeperStreak(s string) string {
	if len(s) < 2 {
		return ""
	}
	return s[len(s)-1:] + s[:len(s)-1]
}

func sleeperTerms(l sleeper.League) Terms {
	t := Terms{PlayoffTeams: l.PlayoffTeams, PlayoffFirst: l.PlayoffWeekStart, MedianGame: l.MedianMatch,
		DivisionsRead: true, Divisions: l.Divisions, StartWeek: l.StartWeek}
	switch l.WaiverType {
	case sleeper.WaiverBudget:
		t.Waivers, t.Budget = WaiversBudget, l.WaiverBudget
	case sleeper.WaiverRolling:
		t.Waivers, t.WaiverOrder = WaiversOrder, OrderRolling
	case sleeper.WaiverReverse:
		t.Waivers, t.WaiverOrder = WaiversOrder, OrderInverseStandings
	}
	if l.PlayoffWeekStart > 0 && l.PlayoffTeams > 0 {
		t.PlayoffLast = l.PlayoffWeekStart + sleeperPlayoffWeeks(playoffRounds(l.PlayoffTeams), l.PlayoffRoundType) - 1
		t.FinalWeeks = sleeperFinalWeeks(l.PlayoffRoundType)
	}
	return t
}

// sleeperFinalWeeks is the weeks Sleeper's championship round runs: two
// under a two-week final or two weeks every round, else one.
func sleeperFinalWeeks(roundType int) int {
	if roundType == roundsTwoWeekFinal || roundType == roundsTwoWeeksEvery {
		return 2
	}
	return 1
}

// Sleeper's playoff round types (settings.playoff_round_type).
const (
	roundsOneWeek       = 0
	roundsTwoWeekFinal  = 1
	roundsTwoWeeksEvery = 2
)

// sleeperPlayoffWeeks is the weeks the playoffs take: a week a round, a
// two-week final, or two weeks every round.
func sleeperPlayoffWeeks(rounds, roundType int) int {
	switch roundType {
	case roundsTwoWeekFinal:
		return rounds + 1
	case roundsTwoWeeksEvery:
		return rounds * 2
	}
	return rounds
}

// playoffRounds is the rounds a bracket of so many teams plays down to
// one: two teams play one, three or four play two, up to eight three.
func playoffRounds(teams int) int {
	rounds := 0
	for size := 1; size < teams; size *= 2 {
		rounds++
	}
	return rounds
}

func espnTerms(l espn.FullLeague) Terms {
	t := Terms{PlayoffTeams: l.PlayoffTeams, PlayoffFirst: l.PlayoffStartWeek, Waivers: WaiversOrder,
		WaiverOrder: espnWaiverOrder(l.Acquisition.OrderReset), Tiebreak: espnTiebreaks[l.SeedingTiebreak],
		DivisionsRead: l.DivisionsRead, Divisions: l.Divisions}
	if l.Acquisition.Budget {
		t.Waivers, t.Budget, t.WaiverOrder = WaiversBudget, l.Acquisition.Total, ""
	}
	if l.PlayoffStartWeek > 0 && l.FinalScoringPeriod >= l.PlayoffStartWeek {
		t.PlayoffLast, t.FinalWeeks = l.FinalScoringPeriod, l.FinalRoundWeeks
	}
	return t
}

// espnWaiverOrder is ESPN's waiverOrderReset as the order's type: a reset
// is the inverse of the standings each week, no reset is rolling; none
// where the read carries none.
func espnWaiverOrder(reset *bool) string {
	switch {
	case reset == nil:
		return ""
	case *reset:
		return OrderInverseStandings
	}
	return OrderRolling
}

// espnTiebreaks is ESPN's playoffSeedingRule, the tie rule its standings
// follow, by the values espn-api and ESPN-Fantasy-Football-API name
// (H2H_RECORD, TOTAL_POINTS_SCORED, INTRA_DIVISION_RECORD,
// TOTAL_POINTS_AGAINST); any other value (RAW_STAT, UNKNOWN) states none.
var espnTiebreaks = map[string]string{
	"H2H_RECORD":            TiebreakHeadToHead,
	"TOTAL_POINTS_SCORED":   TiebreakPointsFor,
	"TOTAL_POINTS_AGAINST":  TiebreakPointsAgainst,
	"INTRA_DIVISION_RECORD": TiebreakDivisionRecord,
}

// terms is the league's settings as the league page shows them.
func terms(snap Snapshot) apitypes.LeagueTerms {
	t := snap.Terms
	out := apitypes.LeagueTerms{
		PlayoffTeams: positive(t.PlayoffTeams), WaiverBudget: positive(t.Budget),
		Roster:       snap.Shape.API(),
		ScoringExtra: scoringExtra(snap.Scoring), ScoringUnstated: unstated(snap.Scoring.Defaulted),
		HostSettingsUrl: orNil(hostSettingsURL(snap.Ref)),
	}
	if t.Waivers != "" {
		w := apitypes.LeagueTermsWaivers(t.Waivers)
		out.Waivers = &w
	}
	if t.WaiverOrder != "" {
		o := apitypes.WaiverOrder(t.WaiverOrder)
		out.WaiverOrder = &o
	}
	if t.Tiebreak != "" {
		b := apitypes.Tiebreak(t.Tiebreak)
		out.Tiebreak = &b
	}
	if t.PlayoffFirst > 0 && t.PlayoffLast >= t.PlayoffFirst {
		out.PlayoffWeeks = &apitypes.PlayoffWeeks{First: t.PlayoffFirst, Last: t.PlayoffLast}
	}
	if rules, err := scoring.FromMap(snap.Scoring.Rules); err == nil {
		out.Scoring = &rules
	}
	if len(t.Seeds) > 0 {
		seeds := make([]apitypes.LeagueTermsPlayoffSeeds, len(t.Seeds))
		for i, s := range t.Seeds {
			seeds[i] = apitypes.LeagueTermsPlayoffSeeds(s)
		}
		out.PlayoffSeeds = &seeds
	}
	return out
}

// ffpcTerms is the rules page's playoffs: as many teams as it seeds, in
// the league playoffs' weeks, each seed by record or points as it states.
// Its blind bidding is not read here.
func ffpcTerms(r ffpc.Rules) Terms {
	t := Terms{PlayoffFirst: r.PlayoffStartWeek, PlayoffLast: r.PlayoffLastWeek, DivisionsRead: true}
	for _, s := range r.Seeds {
		switch s {
		case ffpc.SeedRecord:
			t.Seeds = append(t.Seeds, SeedRecord)
		case ffpc.SeedPoints:
			t.Seeds = append(t.Seeds, SeedPoints)
		default:
			return Terms{PlayoffFirst: t.PlayoffFirst, PlayoffLast: t.PlayoffLast, DivisionsRead: true}
		}
	}
	// playoff_teams draws a cut under that many teams by record: a field
	// seeded partly on points says its count by its seeds alone, so a web
	// that reads only playoff_teams never draws a cut FFPC does not make.
	if !slices.ContainsFunc(t.Seeds, func(s string) bool { return s != SeedRecord }) {
		t.PlayoffTeams = len(t.Seeds)
	}
	return t
}

// unstated is the rule keys a read's scoring held at the standard figure,
// from its defaulted list ("key figure").
func unstated(defaulted []string) []string {
	out := make([]string, 0, len(defaulted))
	for _, d := range defaulted {
		key, _, _ := strings.Cut(d, " ")
		out = append(out, key)
	}
	return out
}

// movesRead says whether the platform's moves are read: ESPN gives us no
// move history.
func movesRead(host string) bool {
	return host != HostESPN
}

// scoringExtra is the host's rules ScoringRules does not carry: by rule
// and figure where the host's read gives them, else in the host's words.
func scoringExtra(s Scoring) []apitypes.DroppedRule {
	if s.DroppedRules != nil {
		return droppedView(s.DroppedRules)
	}
	out := make([]apitypes.DroppedRule, 0, len(s.Dropped))
	for _, words := range s.Dropped {
		out = append(out, apitypes.DroppedRule{Group: apitypes.DroppedRuleGroup(scoring.GroupOther), Rule: words})
	}
	return out
}

// hostSettingsURL is the host's page for the league's settings: ESPN's
// settings page, Sleeper's league (its settings open from there); empty
// for a host whose page we do not know.
func hostSettingsURL(ref Ref) string {
	id := url.PathEscape(ref.LeagueID)
	switch ref.Host {
	case HostSleeper:
		return "https://sleeper.com/leagues/" + id
	case HostESPN:
		return "https://fantasy.espn.com/football/league/settings?" + url.Values{"leagueId": {ref.LeagueID}}.Encode()
	}
	return ""
}

// orNil is s, nil when empty.
func orNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// positive is n, nil when not above 0.
func positive(n int) *int {
	if n <= 0 {
		return nil
	}
	return &n
}
