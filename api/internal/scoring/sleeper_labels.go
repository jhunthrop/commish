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
	"blk_kick": def("blocked kick"), "ff": def("forced fumble"), "def_st_ff": def("forced fumble on defense or special teams"),
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
