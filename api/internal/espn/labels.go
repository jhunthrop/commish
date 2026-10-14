package espn

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/scoring"
)

func off(rule string) scoring.Label   { return scoring.Label{Group: scoring.GroupOffense, Rule: rule} }
func bonus(rule string) scoring.Label { return scoring.Label{Group: scoring.GroupBonus, Rule: rule} }
func kick(rule string) scoring.Label  { return scoring.Label{Group: scoring.GroupKicking, Rule: rule} }
func def(rule string) scoring.Label   { return scoring.Label{Group: scoring.GroupDefense, Rule: rule} }
func other(rule string) scoring.Label { return scoring.Label{Group: scoring.GroupOther, Rule: rule} }

// labels names ESPN's scoring stats in drafter words and the group each is
// listed under, for the rules the import lists as left out (the espn-api
// project's stat map, checked against a real public league's settings).
// No label carries a comma, so a list of them reads.
var labels = map[int]scoring.Label{
	0: off("pass attempt"), 1: off("completion"), 2: off("incompletion"), 21: off("completion percentage"),
	23: off("rush attempt"), 58: off("target"), 59: off("yards after catch"), 64: off("times sacked"),
	68: off("fumble"), 73: off("turnover"), 63: off("fumble recovered for a touchdown"),
	19: off("two-point pass"), 26: off("two-point run"), 44: off("two-point catch"),
	101: off("kickoff return touchdown"), 102: off("punt return touchdown"), 114: off("kick return yards"),
	115: off("punt return yards"),
	15:  bonus("40 yard passing touchdown"), 16: bonus("50 yard passing touchdown"),
	17: bonus("300 to 399 yard passing game"), 18: bonus("400 yard passing game"),
	35: bonus("40 yard rushing touchdown"), 36: bonus("50 yard rushing touchdown"),
	37: bonus("100 to 199 yard rushing game"), 38: bonus("200 yard rushing game"),
	45: bonus("40 yard receiving touchdown"), 46: bonus("50 yard receiving touchdown"),
	56: bonus("100 to 199 yard receiving game"), 57: bonus("200 yard receiving game"),
	74: kick("field goal made from 50 yards or more"), 77: kick("field goal made from 40 to 49 yards"),
	80: kick("field goal made under 40 yards"), 201: kick("field goal made from 60 yards or more"),
	76: kick("field goal missed from 50 yards or more"), 79: kick("field goal missed from 40 to 49 yards"),
	82: kick("field goal missed under 40 yards"), 85: kick("field goal missed"),
	89: def("0 points allowed"), 90: def("1 to 6 points allowed"), 91: def("7 to 13 points allowed"),
	92: def("14 to 17 points allowed"), 120: def("points allowed"), 121: def("18 to 21 points allowed"),
	122: def("22 to 27 points allowed"), 123: def("28 to 34 points allowed"), 124: def("35 to 45 points allowed"),
	125: def("46 or more points allowed"), 127: def("yards allowed"), 128: def("under 100 yards allowed"),
	129: def("100 to 199 yards allowed"), 130: def("200 to 299 yards allowed"), 131: def("300 to 349 yards allowed"),
	132: def("350 to 399 yards allowed"), 133: def("400 to 449 yards allowed"), 134: def("450 to 499 yards allowed"),
	135: def("500 to 549 yards allowed"), 136: def("550 or more yards allowed"),
	93: def("blocked kick returned for a touchdown"), 94: def("defensive touchdown"),
	103: def("interception returned for a touchdown"), 104: def("fumble returned for a touchdown"),
	97: def("blocked kick"), 106: def("forced fumble"), 107: def("assisted tackle"), 108: def("solo tackle"),
	109: def("tackle"), 113: def("pass defended"), 205: def("defensive two-point return"),
	206: def("two-point return"), 209: def("one-point safety"),
	155: other("team win"), 156: other("team loss"), 157: other("team tie"), 158: other("points scored"),
}

// label is a stat in drafter words, or ESPN's number for one we have no
// words for.
func label(stat int) scoring.Label {
	if l, ok := labels[stat]; ok {
		return l
	}
	return other(fmt.Sprintf("ESPN stat %d", stat))
}
