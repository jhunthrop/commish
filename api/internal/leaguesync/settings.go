package leaguesync

import (
	"fmt"
	"sort"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// SettingsFor is the saved league a mock reruns from: the league's
// roster as the rooms draft it, its scoring through the custom-scoring
// path exactly as the host states it, and no draft slot (the league's
// next draft order is not known). When a mock room cannot draft this
// league, the sentence says why and the league still syncs.
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
	return strings.ToLower(msg[:1]) + msg[1:]
}

// ValuationSettings is the league a board is valued for on the league
// page: the saved settings when a mock can rerun the league, otherwise
// the nearest shape the rooms hold, with the league's own scoring.
func ValuationSettings(snap Snapshot, saved *apitypes.LeagueSettings) apitypes.LeagueSettings {
	if saved != nil {
		return *saved
	}
	teams := snap.Shape.Teams
	switch {
	case teams < leagues.MinTeams:
		teams = leagues.MinTeams
	case teams > leagues.MaxTeams:
		teams = leagues.MaxTeams
	}
	preset := apitypes.ScoringPresetPpr
	s := apitypes.LeagueSettings{
		Scoring: apitypes.Scoring{Preset: &preset}, Teams: teams, Lineup: apitypes.LineupStandard,
		Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
		Keepers: []apitypes.Keeper{}, BotStyle: apitypes.BotStyleAdp,
	}
	if len(snap.Scoring.Rules) > 0 {
		rules := snap.Scoring.Rules
		s.Scoring = apitypes.Scoring{Custom: &rules}
	}
	return s
}
