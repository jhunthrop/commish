package leaguesync

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/lobby"
)

// SettingsFor is the saved league a mock reruns from: the league's
// roster as the rooms draft it, its scoring as custom scoring in
// ScoringRules' 21 keys (rules.go: what the host states that the keys do
// not carry is named in Scoring.Dropped, a key the host does not state
// takes the standard figure and is named in Scoring.Defaulted), and no
// draft slot (the league's next draft order is not known). An account
// without custom scoring reruns it on the nearest preset (the mock
// setup's rerunOf). When a mock room cannot draft this league, the
// sentence says why and the league still syncs.
func SettingsFor(snap Snapshot) (apitypes.LeagueSettings, string) {
	sh := snap.Shape
	if len(sh.Unfollowed) > 0 {
		return apitypes.LeagueSettings{}, fmt.Sprintf("A mock draft cannot rerun this league yet: its lineup has %s.", strings.Join(sh.Unfollowed, ", "))
	}
	lineup, ok := lineupOf(sh.Flex, sh.SuperFlex)
	if !ok {
		return apitypes.LeagueSettings{}, fmt.Sprintf("A mock draft cannot rerun this league yet: it starts %d flex and %d superflex spots, and mock drafts start one or two flex spots, or one of each.", sh.Flex, sh.SuperFlex)
	}
	if len(snap.Scoring.Rules) == 0 {
		return apitypes.LeagueSettings{}, "A mock draft cannot rerun this league yet: the league states no scoring we can carry."
	}
	rules := snap.Scoring.Rules
	s := apitypes.LeagueSettings{
		Scoring: apitypes.Scoring{Custom: &rules}, Teams: sh.Teams, Lineup: lineup,
		Roster: apitypes.RosterCounts{
			Qb: sh.QB, Rb: sh.RB, Wr: sh.WR, Te: sh.TE, K: sh.K, Dst: sh.DEF, Bench: sh.Bench,
		},
		Keepers: []apitypes.Keeper{}, BotStyle: apitypes.BotStyleAdp,
	}
	if errs := leagues.Validate(s, ""); errs != nil {
		return apitypes.LeagueSettings{}, "A mock draft cannot rerun this league yet: " + firstProblem(errs) + "."
	}
	return leagues.Normalize(s), ""
}

// lineupOf is the rooms' lineup for the flex counts.
func lineupOf(flex, superFlex int) (apitypes.Lineup, bool) {
	switch {
	case flex == 1 && superFlex == 0:
		return apitypes.LineupStandard, true
	case flex == 2 && superFlex == 0:
		return apitypes.LineupTwoFlex, true
	case flex == 1 && superFlex == 1:
		return apitypes.LineupSuperflex, true
	}
	return "", false
}

func firstProblem(errs map[string]string) string {
	keys := make([]string, 0, len(errs))
	for k := range errs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	msg := errs[keys[0]]
	r, size := utf8.DecodeRuneInString(msg)
	if size == 0 {
		return "its settings do not check out"
	}
	return string(unicode.ToLower(r)) + msg[size:]
}

// ValuationSettings is the league our board is valued for on the league
// page: the saved league's shape when a mock can rerun it, otherwise the
// rooms' standard roster at the nearest team count the rooms hold, and
// in both the preset the league's rules score most like, so the board is
// one the rooms carry whatever the rules.
func ValuationSettings(snap Snapshot, saved *apitypes.LeagueSettings) apitypes.LeagueSettings {
	preset := NearestPreset(snap.Scoring.Rules)
	if saved != nil {
		s := *saved
		s.Scoring = apitypes.Scoring{Preset: &preset}
		return s
	}
	teams := min(max(snap.Shape.Teams, leagues.MinTeams), leagues.MaxTeams)
	return lobby.Format{Scoring: preset, Teams: teams, Lineup: apitypes.LineupStandard}.Settings()
}
