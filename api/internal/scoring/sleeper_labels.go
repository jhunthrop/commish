package scoring

import (
	"fmt"
	"strings"
)

// sleeperLabels names Sleeper's scoring settings in drafter words, for the
// settings the 21 rules do not carry, which the setup page names as not
// counted. A setting with no words here is named "Sleeper setting <key>".
var sleeperLabels = map[string]string{
	"pts_allow_0": "defense, 0 points allowed", "pts_allow_1_6": "defense, 1 to 6 points allowed",
	"pts_allow_7_13": "defense, 7 to 13 points allowed", "pts_allow_14_20": "defense, 14 to 20 points allowed",
	"pts_allow_21_27": "defense, 21 to 27 points allowed", "pts_allow_28_34": "defense, 28 to 34 points allowed",
	"pts_allow_35p":   "defense, 35+ points allowed",
	"yds_allow_0_100": "defense, under 100 yards allowed", "yds_allow_100_199": "defense, 100 to 199 yards allowed",
	"yds_allow_200_299": "defense, 200 to 299 yards allowed", "yds_allow_300_349": "defense, 300 to 349 yards allowed",
	"yds_allow_350_399": "defense, 350 to 399 yards allowed", "yds_allow_400_449": "defense, 400 to 449 yards allowed",
	"yds_allow_450_499": "defense, 450 to 499 yards allowed", "yds_allow_500_549": "defense, 500 to 549 yards allowed",
	"yds_allow_550p": "defense, 550+ yards allowed",
	"blk_kick":       "defense, blocked kick", "ff": "defense, forced fumble", "def_st_ff": "defense or special teams, forced fumble",
	"def_st_fum_rec": "defense or special teams, fumble recovery", "def_st_td": "defense or special teams, touchdown",
	"def_2pt": "defense, two-point return", "st_td": "special teams touchdown", "st_ff": "special teams, forced fumble",
	"st_fum_rec": "special teams, fumble recovery", "fum_rec_td": "fumble recovered for a touchdown", "fum": "fumble",
	"pass_cmp": "completion", "pass_att": "pass attempt", "pass_inc": "incompletion", "pass_sack": "times sacked",
	"pass_int_td": "interception returned for a touchdown, thrown", "pass_fd": "passing first down",
	"rush_att": "rush attempt", "rush_fd": "rushing first down", "rec_fd": "receiving first down", "rec_tgt": "target",
	"bonus_pass_yd_300": "300+ yard passing game", "bonus_pass_yd_400": "400+ yard passing game",
	"bonus_rush_yd_100": "100+ yard rushing game", "bonus_rush_yd_200": "200+ yard rushing game",
	"bonus_rec_yd_100": "100+ yard receiving game", "bonus_rec_yd_200": "200+ yard receiving game",
	"bonus_rec_rb": "extra for a running back catch", "bonus_rec_wr": "extra for a receiver catch",
	"bonus_pass_cmp_25": "25+ completions", "bonus_rush_att_20": "20+ rushes",
	"fgm_40_49": "field goal made, 40 to 49 yards", "fgm_50p": "field goal made, 50+ yards",
	"fgmiss_40_49": "field goal missed, 40 to 49 yards", "fgmiss_50p": "field goal missed, 50+ yards",
	"fgm_0_19": "field goal made, under 20 yards", "fgm_20_29": "field goal made, 20 to 29 yards",
	"fgm_30_39": "field goal made, 30 to 39 yards", "kr_yd": "kick return yards", "pr_yd": "punt return yards",
	"tkl": "tackle", "tkl_solo": "solo tackle", "tkl_ast": "assisted tackle", "tkl_loss": "tackle for a loss",
	"qb_hit": "quarterback hit", "pass_def": "pass defended", "idp_sack": "defender sack",
}

// sleeperWords is a Sleeper setting and its figure in drafter words.
func sleeperWords(key string, figure float64) string {
	label, ok := sleeperLabels[key]
	if !ok {
		label = "Sleeper setting " + strings.ReplaceAll(key, "_", " ")
	}
	return HostText(fmt.Sprintf("%s %g", label, figure))
}
