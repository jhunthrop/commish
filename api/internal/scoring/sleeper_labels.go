package scoring

import "strings"

func off(rule string) Label   { return Label{GroupOffense, rule} }
func bonus(rule string) Label { return Label{GroupBonus, rule} }
func kick(rule string) Label  { return Label{GroupKicking, rule} }
func def(rule string) Label   { return Label{GroupDefense, rule} }

// sleeperLabels names Sleeper's scoring settings in drafter words, for the
// settings the 21 rules do not carry, which the setup page lists as left
// out by group. A setting with no words here is "Sleeper setting <key>".
var sleeperLabels = map[string]Label{
	"pts_allow_0": def("0 points allowed"), "pts_allow_1_6": def("1 to 6 points allowed"),
	"pts_allow_7_13": def("7 to 13 points allowed"), "pts_allow_14_20": def("14 to 20 points allowed"),
	"pts_allow_21_27": def("21 to 27 points allowed"), "pts_allow_28_34": def("28 to 34 points allowed"),
	"pts_allow_35p":   def("35 or more points allowed"),
	"yds_allow_0_100": def("under 100 yards allowed"), "yds_allow_100_199": def("100 to 199 yards allowed"),
	"yds_allow_200_299": def("200 to 299 yards allowed"), "yds_allow_300_349": def("300 to 349 yards allowed"),
	"yds_allow_350_399": def("350 to 399 yards allowed"), "yds_allow_400_449": def("400 to 449 yards allowed"),
	"yds_allow_450_499": def("450 to 499 yards allowed"), "yds_allow_500_549": def("500 to 549 yards allowed"),
	"yds_allow_550p": def("550 or more yards allowed"),
	"blk_kick":       def("blocked kick"), "ff": def("forced fumble"), "def_st_ff": def("forced fumble on defense or special teams"),
	"def_st_fum_rec": def("fumble recovery on defense or special teams"), "def_st_td": def("touchdown on defense or special teams"),
	"def_2pt": def("two-point return"), "st_td": def("special teams touchdown"), "st_ff": def("special teams forced fumble"),
	"st_fum_rec": def("special teams fumble recovery"), "tkl": def("tackle"), "tkl_solo": def("solo tackle"),
	"tkl_ast": def("assisted tackle"), "tkl_loss": def("tackle for a loss"), "qb_hit": def("quarterback hit"),
	"pass_def": def("pass defended"), "idp_sack": def("defender sack"),
	"fum_rec_td": off("fumble recovered for a touchdown"), "fum": off("fumble"),
	"pass_cmp": off("completion"), "pass_att": off("pass attempt"), "pass_inc": off("incompletion"),
	"pass_sack": off("times sacked"), "pass_int_td": off("interception thrown and returned for a touchdown"),
	"pass_fd": off("passing first down"), "rush_att": off("rush attempt"), "rush_fd": off("rushing first down"),
	"rec_fd": off("receiving first down"), "rec_tgt": off("target"), "kr_yd": off("kick return yards"),
	"pr_yd":             off("punt return yards"),
	"bonus_pass_yd_300": bonus("300 yard passing game"), "bonus_pass_yd_400": bonus("400 yard passing game"),
	"bonus_rush_yd_100": bonus("100 yard rushing game"), "bonus_rush_yd_200": bonus("200 yard rushing game"),
	"bonus_rec_yd_100": bonus("100 yard receiving game"), "bonus_rec_yd_200": bonus("200 yard receiving game"),
	"bonus_rec_rb": bonus("extra for a running back catch"), "bonus_rec_wr": bonus("extra for a receiver catch"),
	"bonus_pass_cmp_25": bonus("25 completions in a game"), "bonus_rush_att_20": bonus("20 rushes in a game"),
	"fgm_0_19": kick("field goal made under 20 yards"), "fgm_20_29": kick("field goal made from 20 to 29 yards"),
	"fgm_30_39": kick("field goal made from 30 to 39 yards"), "fgm_40_49": kick("field goal made from 40 to 49 yards"),
	"fgm_50p": kick("field goal made from 50 yards or more"), "fgmiss_40_49": kick("field goal missed from 40 to 49 yards"),
	"fgmiss_50p": kick("field goal missed from 50 yards or more"),
}

// sleeperDropped is a Sleeper setting the 21 rules leave out, in drafter
// words.
func sleeperDropped(key string, figure float64) DroppedRule {
	label, ok := sleeperLabels[key]
	if !ok {
		label = Label{GroupOther, "Sleeper setting " + strings.ReplaceAll(key, "_", " ")}
	}
	return Dropped(label, figure)
}
