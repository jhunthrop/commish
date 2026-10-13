// Package leagues is saved league settings: the setup screen saved under
// a name, so a rerun is one tap (docs/design/2026-10-12-mock-room-rethink.md,
// Setup). The settings shape and its validation live here and are the
// one rule mocks and rooms use too.
package leagues

import (
	"fmt"
	"math"
	"regexp"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Bounds, matching openapi.yaml's LeagueSettings.
const (
	MinTeams          = 8
	MaxTeams          = 14
	MinRounds         = 8
	MaxRounds         = 25
	MaxKeepersPerTeam = 4
	MaxCustomStats    = 200
	maxStatPoints     = 100
)

var statKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// flexSpots is how many flex starters each lineup adds to the roster
// counts: standard has one flex, superflex a flex and a superflex, two
// flex two. ok is false for a lineup that is not one of the three.
func flexSpots(l apitypes.Lineup) (n int, ok bool) {
	switch l {
	case apitypes.LineupStandard:
		return 1, true
	case apitypes.LineupSuperflex, apitypes.LineupTwoFlex:
		return 2, true
	}
	return 0, false
}

// Rounds is the draft's round count: every roster spot, flex included.
func Rounds(s apitypes.LeagueSettings) int {
	r := s.Roster
	flex, _ := flexSpots(s.Lineup)
	return r.Qb + r.Rb + r.Wr + r.Te + r.K + r.Dst + r.Bench + flex
}

// UsesCustomScoring reports whether s needs the custom_scoring feature.
func UsesCustomScoring(s apitypes.LeagueSettings) bool {
	return s.Scoring.Custom != nil
}

// Validate returns every problem with s, keyed by field path under
// prefix, or nil when s is sound.
func Validate(s apitypes.LeagueSettings, prefix string) map[string]string {
	errs := map[string]string{}
	add := func(field, msg string) { errs[prefix+field] = msg }

	validateScoring(s.Scoring, add)
	if s.Teams < MinTeams || s.Teams > MaxTeams {
		add("teams", fmt.Sprintf("Pick %d to %d teams", MinTeams, MaxTeams))
	}
	if s.Slot != nil && (*s.Slot < 1 || *s.Slot > s.Teams) {
		add("slot", "Pick a slot in the league, or none for a random one")
	}
	if _, ok := flexSpots(s.Lineup); !ok {
		add("lineup", "Pick standard, superflex or two flex")
	}
	if !s.BotStyle.Valid() {
		add("bot_style", "Pick how the bots draft")
	} else if s.BotStyle == apitypes.BotStyleLastDraft {
		add("bot_style", "Your league's last draft needs a league import first")
	}
	rounds := Rounds(s)
	if rounds < MinRounds || rounds > MaxRounds {
		add("roster", fmt.Sprintf("The roster makes %d rounds, keep it from %d to %d", rounds, MinRounds, MaxRounds))
	}
	validateKeepers(s, rounds, add)
	if len(errs) == 0 {
		return nil
	}
	return errs
}

func validateScoring(sc apitypes.Scoring, add func(string, string)) {
	switch {
	case (sc.Preset == nil) == (sc.Custom == nil):
		add("scoring", "Pick a preset or custom scoring, not both")
	case sc.Preset != nil && !sc.Preset.Valid():
		add("scoring.preset", "Pick PPR, half PPR, standard or TE premium")
	case sc.Custom != nil:
		custom := *sc.Custom
		if len(custom) == 0 || len(custom) > MaxCustomStats {
			add("scoring.custom", fmt.Sprintf("Custom scoring needs 1 to %d stats", MaxCustomStats))
		}
		for k, v := range custom {
			if !statKey.MatchString(k) {
				add("scoring.custom."+k, "Stat names are lowercase letters, digits and underscores")
			} else if math.IsNaN(v) || math.Abs(v) > maxStatPoints {
				add("scoring.custom."+k, fmt.Sprintf("Points per stat stay within %d either way", maxStatPoints))
			}
		}
	}
}

func validateKeepers(s apitypes.LeagueSettings, rounds int, add func(string, string)) {
	if len(s.Keepers) > s.Teams*MaxKeepersPerTeam {
		add("keepers", fmt.Sprintf("Keep at most %d players a team", MaxKeepersPerTeam))
		return
	}
	players := map[string]bool{}
	picks := map[[2]int]bool{}
	for i, k := range s.Keepers {
		field := fmt.Sprintf("keepers.%d", i)
		switch {
		case k.Slot < 1 || k.Slot > s.Teams:
			add(field+".slot", "That slot is not in the league")
		case k.Round < 1 || k.Round > rounds:
			add(field+".round", "That round is not in the draft")
		case k.PlayerId == "" || len(k.PlayerId) > 64:
			add(field+".player_id", "Pick a player")
		case players[k.PlayerId]:
			add(field+".player_id", "That player is already kept")
		case picks[[2]int{k.Slot, k.Round}]:
			add(field+".round", "That team already keeps someone in that round")
		}
		players[k.PlayerId] = true
		picks[[2]int{k.Slot, k.Round}] = true
	}
}
