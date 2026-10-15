package yahoo

import (
	"fmt"
	"strings"

	"github.com/jhunthrop/commish/api/internal/scoring"
)

// sleeperKeys puts a Yahoo football stat in Sleeper's setting names, the
// names the one import map reads (scoring.FromSleeper), so a Yahoo
// league's scoring takes the path every host's takes. A stat on two keys
// (the two-point trio, the kick and punt return touchdowns) sets each.
// Yahoo's stat ids are its documented football stat categories.
var sleeperKeys = map[int][]string{
	4: {"pass_yd"}, 5: {"pass_td"}, 6: {"pass_int"}, 9: {"rush_yd"}, 10: {"rush_td"}, 11: {"rec"},
	12: {"rec_yd"}, 13: {"rec_td"}, 15: {"kr_td", "pr_td"}, 16: {"pass_2pt", "rush_2pt", "rec_2pt"},
	17: {"fum"}, 18: {"fum_lost"},
	19: {"fgm_0_19"}, 20: {"fgm_20_29"}, 21: {"fgm_30_39"}, 22: {"fgm_40_49"}, 23: {"fgm_50p"},
	24: {"fgmiss_0_19"}, 25: {"fgmiss_20_29"}, 26: {"fgmiss_30_39"}, 27: {"fgmiss_40_49"}, 28: {"fgmiss_50p"},
	29: {"xpm"}, 30: {"xpmiss"},
	32: {"sack"}, 33: {"int"}, 34: {"fum_rec"}, 35: {"def_td"}, 36: {"safe"}, 37: {"blk_kick"},
	50: {"pts_allow_0"}, 51: {"pts_allow_1_6"}, 52: {"pts_allow_7_13"}, 53: {"pts_allow_14_20"},
	54: {"pts_allow_21_27"}, 55: {"pts_allow_28_34"}, 56: {"pts_allow_35p"},
	57: {"fum_rec_td"},
}

// groupOf is a Yahoo stat's position type as the setup page groups a
// left-out rule.
func groupOf(positionType string) string {
	switch positionType {
	case "O":
		return scoring.GroupOffense
	case "K":
		return scoring.GroupKicking
	case "DT", "DP":
		return scoring.GroupDefense
	}
	return scoring.GroupOther
}

// Scoring is the league's scoring as ScoringRules: every stat Sleeper's
// names carry through the one import map, every other stat the league
// scores named in Yahoo's own words with its figure, and every bonus
// named with its target.
func (s Settings) Scoring() scoring.Imported {
	stats := map[int]Stat{}
	for _, st := range s.Stats {
		stats[st.ID] = st
	}
	host := map[string]float64{}
	var left []scoring.DroppedRule
	for _, m := range s.Modifiers {
		st, named := stats[m.StatID]
		if named && !st.Enabled {
			continue
		}
		label := scoring.Label{Group: groupOf(st.PositionType), Rule: st.Name}
		if !named || strings.TrimSpace(st.Name) == "" {
			label = scoring.Label{Group: scoring.GroupOther, Rule: fmt.Sprintf("Yahoo stat %d", m.StatID)}
		}
		for _, b := range m.Bonuses {
			if b.Points != 0 {
				left = append(left, scoring.Dropped(scoring.Label{Group: scoring.GroupBonus, Rule: fmt.Sprintf("%s bonus at %g", label.Rule, b.Target)}, b.Points))
			}
		}
		keys, mapped := sleeperKeys[m.StatID]
		if !mapped {
			if m.Points != 0 {
				left = append(left, scoring.Dropped(label, m.Points))
			}
			continue
		}
		for _, k := range keys {
			host[k] = m.Points
		}
	}
	im := scoring.FromSleeper(host)
	im.Dropped = append(im.Dropped, left...)
	scoring.SortDropped(im.Dropped)
	return im
}
