package companion

import (
	"fmt"
	"sort"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Sleeper's roster settings the companion follows, by their draft
// settings keys. Any other slots_* key with a count is a roster shape
// the rooms do not draft, refused by name.
const (
	slotQB        = "slots_qb"
	slotRB        = "slots_rb"
	slotWR        = "slots_wr"
	slotTE        = "slots_te"
	slotFlex      = "slots_flex"
	slotSuperFlex = "slots_super_flex"
	slotK         = "slots_k"
	slotDEF       = "slots_def"
	slotBench     = "slots_bn"
)

func followedSlots() map[string]bool {
	return map[string]bool{
		slotQB: true, slotRB: true, slotWR: true, slotTE: true, slotFlex: true, slotSuperFlex: true,
		slotK: true, slotDEF: true, slotBench: true,
	}
}

// slotWords names a roster setting the companion does not follow.
func slotWords(key string) string {
	switch key {
	case "slots_wrrb_flex":
		return "a running back or receiver flex spot"
	case "slots_rec_flex":
		return "a receiver or tight end flex spot"
	default:
		return "defensive players (" + strings.TrimPrefix(key, "slots_") + ")"
	}
}

func refuse(format string, args ...any) error {
	return &draft.Refusal{Reason: fmt.Sprintf(format, args...)}
}

// checkDraft refuses a draft the companion cannot follow pick by pick:
// an auction, a linear order, a third-round reversal.
func checkDraft(d sleeper.Draft) error {
	switch {
	case d.Type == sleeper.TypeAuction:
		return refuse("This is an auction draft. The companion follows snake drafts.")
	case d.Type == sleeper.TypeLinear:
		return refuse("This draft runs in the same order every round. The companion follows snake drafts.")
	case d.ReversalRound > 0:
		return refuse("This draft reverses the order in round %d. The companion follows a snake with no reversal.", d.ReversalRound)
	}
	return nil
}

// lineupOf is the lineup the flex counts make, or a refusal.
func lineupOf(flex, superFlex int) (apitypes.Lineup, error) {
	switch {
	case flex == 1 && superFlex == 0:
		return apitypes.LineupStandard, nil
	case flex == 2 && superFlex == 0:
		return apitypes.LineupTwoFlex, nil
	case flex == 1 && superFlex == 1:
		return apitypes.LineupSuperflex, nil
	}
	return "", refuse("This draft starts %d flex and %d superflex spots. The companion follows one or two flex spots, or one of each.", flex, superFlex)
}

// rosterOf maps the draft's slots_* settings to the rooms' roster, the
// bench made up to the draft's rounds.
func rosterOf(d sleeper.Draft) (apitypes.RosterCounts, apitypes.Lineup, error) {
	keys := make([]string, 0, len(d.Slots))
	for k := range d.Slots {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if d.Slots[k] > 0 && !followedSlots()[k] {
			return apitypes.RosterCounts{}, "", refuse("This draft has %s. The companion follows QB, RB, WR, TE, flex, superflex, K, DEF and the bench.", slotWords(k))
		}
	}
	lineup, err := lineupOf(d.Slots[slotFlex], d.Slots[slotSuperFlex])
	if err != nil {
		return apitypes.RosterCounts{}, "", err
	}
	r := apitypes.RosterCounts{
		Qb: d.Slots[slotQB], Rb: d.Slots[slotRB], Wr: d.Slots[slotWR], Te: d.Slots[slotTE], K: d.Slots[slotK], Dst: d.Slots[slotDEF],
	}
	starters := r.Qb + r.Rb + r.Wr + r.Te + r.K + r.Dst + d.Slots[slotFlex] + d.Slots[slotSuperFlex]
	if d.Rounds < starters {
		return apitypes.RosterCounts{}, "", refuse("This draft has %d rounds for %d starters. The companion follows drafts that fill every starter.", d.Rounds, starters)
	}
	r.Bench = d.Rounds - starters
	return r, lineup, nil
}

// scoringOf is the draft's scoring: its league's exact rules (the
// boards service scores them, Lane 8 part A), or, for a mock draft with
// no league, the preset its scoring type names.
func scoringOf(d sleeper.Draft, league *sleeper.League) (apitypes.Scoring, error) {
	if league != nil && len(league.Scoring) > 0 {
		rules, err := scoring.FromMap(scoring.FromSleeper(league.Scoring).Rules)
		if err != nil {
			return apitypes.Scoring{}, fmt.Errorf("companion: the league's rules: %w", err)
		}
		return apitypes.Scoring{Custom: &rules}, nil
	}
	preset := presetOf(d)
	return apitypes.Scoring{Preset: &preset}, nil
}

// presetOf is the preset a mock draft's scoring type names.
func presetOf(d sleeper.Draft) apitypes.ScoringPreset {
	switch t := strings.ToLower(d.ScoringType); {
	case strings.Contains(t, "half"):
		return apitypes.ScoringPresetHalfPpr
	case strings.Contains(t, "std"):
		return apitypes.ScoringPresetStandard
	default:
		return apitypes.ScoringPresetPpr
	}
}

// SettingsFor is the league settings a host draft maps to with the
// drafter in seat, or a refusal saying what the companion does not
// follow. Keepers are not settings here: the host's keeper picks are
// applied where they fall, like every other pick.
func SettingsFor(d sleeper.Draft, league *sleeper.League, seat int) (apitypes.LeagueSettings, error) {
	if err := checkDraft(d); err != nil {
		return apitypes.LeagueSettings{}, err
	}
	if d.Teams < leagues.MinTeams || d.Teams > leagues.MaxTeams {
		return apitypes.LeagueSettings{}, refuse("This draft has %d teams. The companion follows %d to %d.", d.Teams, leagues.MinTeams, leagues.MaxTeams)
	}
	roster, lineup, err := rosterOf(d)
	if err != nil {
		return apitypes.LeagueSettings{}, err
	}
	sc, err := scoringOf(d, league)
	if err != nil {
		return apitypes.LeagueSettings{}, err
	}
	s := apitypes.LeagueSettings{
		Scoring: sc, Teams: d.Teams, Slot: &seat, Roster: roster, Lineup: lineup,
		Keepers: []apitypes.Keeper{}, BotStyle: apitypes.BotStyleAdp,
	}
	if errs := leagues.Validate(s, ""); errs != nil {
		return apitypes.LeagueSettings{}, refuse("This draft's league is outside what the companion follows: %s.", firstProblem(errs))
	}
	return leagues.Normalize(s), nil
}

func firstProblem(errs map[string]string) string {
	keys := make([]string, 0, len(errs))
	for k := range errs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.ToLower(errs[keys[0]][:1]) + errs[keys[0]][1:]
}
