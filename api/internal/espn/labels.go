package espn

import "fmt"

// labels names ESPN's scoring stats in drafter words, for the rules the
// import names as dropped (the espn-api project's stat map, checked
// against a real public league's settings).
var labels = map[int]string{
	0: "pass attempts", 1: "completions", 2: "incompletions", 15: "40+ yard passing TD", 16: "50+ yard passing TD",
	17: "300 to 399 yard passing game", 18: "400+ yard passing game", 21: "completion percentage",
	23: "rush attempts", 35: "40+ yard rushing TD", 36: "50+ yard rushing TD", 37: "100 to 199 yard rushing game",
	38: "200+ yard rushing game", 45: "40+ yard receiving TD", 46: "50+ yard receiving TD",
	56: "100 to 199 yard receiving game", 57: "200+ yard receiving game", 58: "targets", 59: "yards after catch",
	63: "fumble recovered for a TD", 64: "times sacked", 68: "fumbles", 73: "turnovers",
	74: "field goal made, 50+ yards", 77: "field goal made, 40 to 49 yards", 80: "field goal made, under 40 yards",
	89: "defense, 0 points allowed", 90: "defense, 1 to 6 points allowed", 91: "defense, 7 to 13 points allowed",
	92: "defense, 14 to 17 points allowed", 97: "defense, blocked kick", 106: "defense, forced fumble",
	107: "defense, assisted tackle", 108: "defense, solo tackle", 109: "defense, tackle", 113: "defense, pass defended",
	114: "kick return yards", 115: "punt return yards", 120: "defense, points allowed",
	121: "defense, 18 to 21 points allowed", 122: "defense, 22 to 27 points allowed",
	123: "defense, 28 to 34 points allowed", 124: "defense, 35 to 45 points allowed",
	125: "defense, 46+ points allowed", 127: "defense, yards allowed", 128: "defense, under 100 yards allowed",
	129: "defense, 100 to 199 yards allowed", 130: "defense, 200 to 299 yards allowed",
	131: "defense, 300 to 349 yards allowed", 132: "defense, 350 to 399 yards allowed",
	133: "defense, 400 to 449 yards allowed", 134: "defense, 450 to 499 yards allowed",
	135: "defense, 500 to 549 yards allowed", 136: "defense, 550+ yards allowed",
	155: "team win", 156: "team loss", 157: "team tie", 158: "points scored",
}

// label is a stat in drafter words, or ESPN's number for one we have no
// words for.
func label(stat int) string {
	if l, ok := labels[stat]; ok {
		return l
	}
	return fmt.Sprintf("ESPN stat %d", stat)
}
