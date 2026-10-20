package leaguesync

import (
	"net/url"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Waiver kinds, as the contract (LeagueTerms.waivers) spells them.
const (
	WaiversBudget = "budget"
	WaiversOrder  = "order"
)

// Terms is the host's word on a league's waivers and playoffs. A zero
// field is one the host does not say.
type Terms struct {
	Waivers      string `json:"waivers,omitempty"`
	Budget       int    `json:"budget,omitempty"`
	PlayoffTeams int    `json:"playoff_teams,omitempty"`
	// PlayoffFirst and PlayoffLast are the playoffs' first and last week.
	PlayoffFirst int `json:"playoff_first,omitempty"`
	PlayoffLast  int `json:"playoff_last,omitempty"`
	// FinalWeeks is how many weeks the championship round runs: 2 for a
	// two-week final, 1 for one week, 0 when the host does not say.
	FinalWeeks int `json:"final_weeks,omitempty"`
}

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
	t := Terms{PlayoffTeams: l.PlayoffTeams, PlayoffFirst: l.PlayoffWeekStart}
	switch l.WaiverType {
	case sleeper.WaiverBudget:
		t.Waivers, t.Budget = WaiversBudget, l.WaiverBudget
	case sleeper.WaiverRolling, sleeper.WaiverReverse:
		t.Waivers = WaiversOrder
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
	t := Terms{PlayoffTeams: l.PlayoffTeams, PlayoffFirst: l.PlayoffStartWeek, Waivers: WaiversOrder}
	if l.Acquisition.Budget {
		t.Waivers, t.Budget = WaiversBudget, l.Acquisition.Total
	}
	if l.PlayoffStartWeek > 0 && l.FinalScoringPeriod >= l.PlayoffStartWeek {
		t.PlayoffLast, t.FinalWeeks = l.FinalScoringPeriod, l.FinalRoundWeeks
	}
	return t
}

// terms is the league's settings as the league page shows them.
func terms(snap Snapshot) apitypes.LeagueTerms {
	t := snap.Terms
	out := apitypes.LeagueTerms{
		PlayoffTeams: positive(t.PlayoffTeams), WaiverBudget: positive(t.Budget),
		Roster: apitypes.LeagueShape{
			Qb: snap.Shape.QB, Rb: snap.Shape.RB, Wr: snap.Shape.WR, Te: snap.Shape.TE, Flex: snap.Shape.Flex,
			SuperFlex: snap.Shape.SuperFlex, K: snap.Shape.K, Def: snap.Shape.DEF, Bench: snap.Shape.Bench,
		},
		ScoringExtra: scoringExtra(snap.Scoring), ScoringUnstated: unstated(snap.Scoring.Defaulted),
		HostSettingsUrl: orNil(hostSettingsURL(snap.Ref)),
	}
	if t.Waivers != "" {
		w := apitypes.LeagueTermsWaivers(t.Waivers)
		out.Waivers = &w
	}
	if t.PlayoffFirst > 0 && t.PlayoffLast >= t.PlayoffFirst {
		out.PlayoffWeeks = &apitypes.PlayoffWeeks{First: t.PlayoffFirst, Last: t.PlayoffLast}
	}
	if rules, err := scoring.FromMap(snap.Scoring.Rules); err == nil {
		out.Scoring = &rules
	}
	return out
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
