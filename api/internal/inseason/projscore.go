package inseason

import (
	"maps"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// projectionScoring is the scoring the week's projection is read in for a
// league (Lane 66d review H2): the column the league scores most like
// (PPR, half PPR or standard; a tight end premium reads PPR), and whether
// that is the league's own scoring or the closest of the three to rules
// of its own.
func projectionScoring(saved apitypes.LeagueSettings) apitypes.ProjectionScoring {
	like, _ := leaguesync.LeagueScoring(&saved, nil, false)
	format := apitypes.ProjectionScoringFormatPpr
	switch like {
	case apitypes.ScoringPresetHalfPpr:
		format = apitypes.ProjectionScoringFormatHalfPpr
	case apitypes.ScoringPresetStandard:
		format = apitypes.ProjectionScoringFormatStandard
	}
	return apitypes.ProjectionScoring{Format: format, LeagueOwn: ownScoring(saved.Scoring, like)}
}

// ownScoring is whether a league scores exactly as the preset it is read
// in: a saved preset of the three, or rules of its own that equal one,
// every rule alike.
func ownScoring(s apitypes.Scoring, like apitypes.ScoringPreset) bool {
	if like == apitypes.ScoringPresetTePremium {
		return false
	}
	if s.Custom == nil {
		return s.Preset != nil && *s.Preset == like
	}
	return maps.Equal(scoring.ToMap(*s.Custom), scoring.ToMap(scoring.PresetRules(like)))
}
