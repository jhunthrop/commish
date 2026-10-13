package leaguesync

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jhunthrop/commish/api/internal/mfl"
)

// MyFantasyLeague states scoring as rules: an event code (TYPE=allRules
// names them), the range of the event's value it applies over, and the
// points, "*0.04" for each unit or a flat figure for a value inside the
// range. A rule is put in Sleeper's key for it only when it says exactly
// what the key says, and from there into ScoringRules (rules.go); every
// rule that does not land in ScoringRules is named in Dropped with the
// league's own words.

// perUnit is each event scored per unit, by its custom key.
func perUnit() map[string]string {
	return map[string]string{
		"#P": "pass_td", "PY": "pass_yd", "IN": "pass_int", "P2": "pass_2pt",
		"#R": "rush_td", "RY": "rush_yd", "R2": "rush_2pt",
		"#C": "rec_td", "CY": "rec_yd", "CC": "rec", "C2": "rec_2pt",
		"EP": "xpm", "EM": "xpmiss", "MG": "fgmiss", "FL": "fum_lost", "FLO": "fum_lost",
		"#UT": "pr_td", "#KT": "kr_td", "#FR": "fum_rec_td",
		"SK": "sack", "IC": "int", "FC": "fum_rec", "SF": "safe", "#T": "def_td", "#D": "def_td",
	}
}

// yardBonuses is a flat bonus for reaching a yardage, by event and the
// yardage the range starts at.
func yardBonuses() map[string]string {
	return map[string]string{
		"PY/300": "bonus_pass_yd_300", "PY/400": "bonus_pass_yd_400",
		"RY/100": "bonus_rush_yd_100", "RY/200": "bonus_rush_yd_200",
		"CY/100": "bonus_rec_yd_100", "CY/200": "bonus_rec_yd_200",
	}
}

// allowedTiers is a defense's points-allowed bracket by its exact range.
func allowedTiers() map[string]string {
	return map[string]string{
		"0-0": "pts_allow_0", "1-6": "pts_allow_1_6", "7-13": "pts_allow_7_13", "14-20": "pts_allow_14_20",
		"21-27": "pts_allow_21_27", "28-34": "pts_allow_28_34", "35-99": "pts_allow_35p", "35-999": "pts_allow_35p",
	}
}

// fieldGoalTiers is a made field goal's flat points by its exact range.
func fieldGoalTiers() map[string][]string {
	return map[string][]string{
		"0-19": {"fgm_0_19"}, "20-29": {"fgm_20_29"}, "30-39": {"fgm_30_39"}, "40-49": {"fgm_40_49"},
		"50-99": {"fgm_50p"}, "0-29": {"fgm_0_19", "fgm_20_29"}, "0-39": {"fgm_0_19", "fgm_20_29", "fgm_30_39"},
	}
}

func allowedEvents() map[string]bool {
	return map[string]bool{"TPA": true, "PA": true, "STPA+OPA": true, "OPA+STPA": true}
}

var rangePattern = regexp.MustCompile(`^(-?[0-9]{1,4})-(-?[0-9]{1,4})$`)

// openEnded is a range's top that stands for "and up".
const openEnded = 99

type mflRule struct {
	mfl.Rule
	lo, hi  int
	value   float64
	perUnit bool
}

func parseRule(r mfl.Rule) (mflRule, bool) {
	m := rangePattern.FindStringSubmatch(strings.TrimSpace(r.Range))
	if m == nil {
		return mflRule{}, false
	}
	lo, _ := strconv.Atoi(m[1])
	hi, _ := strconv.Atoi(m[2])
	pts := strings.TrimSpace(r.Points)
	per := strings.HasPrefix(pts, "*")
	v, err := strconv.ParseFloat(strings.TrimPrefix(pts, "*"), 64)
	if err != nil || math.IsNaN(v) || math.Abs(v) > maxCustomPoints {
		return mflRule{}, false
	}
	return mflRule{Rule: r, lo: lo, hi: hi, value: v, perUnit: per}, true
}

// groupKind sorts a rule's positions: every offensive position (the
// league's general rule), a tight end alone, a defense, or other.
func groupKind(positions string) string {
	set := map[string]bool{}
	for _, p := range strings.Split(positions, "|") {
		set[strings.TrimSpace(p)] = true
	}
	switch {
	case set["QB"] && set["RB"] && set["WR"] && set["TE"]:
		return "offense"
	case len(set) == 1 && set["TE"]:
		return "te"
	case len(set) == 1 && set["Def"]:
		return "def"
	case len(set) == 1 && set["PK"]:
		return "k"
	}
	return "other"
}

// mflScoring maps the league's rules to ScoringRules, naming in the
// league's own words every rule that does not land there.
func mflScoring(rules []mfl.Rule) Scoring {
	host := map[string]float64{}
	sources := map[string][]string{}
	te := map[string]float64{}
	conflicts := map[string]bool{}
	var dropped []string
	for _, raw := range rules {
		words := ruleWords(raw)
		put := func(key string, v float64) {
			if prev, ok := host[key]; ok && prev != v {
				conflicts[key] = true
			}
			host[key] = v
			sources[key] = append(sources[key], words)
		}
		r, ok := parseRule(raw)
		if !ok || !carry(r, groupKind(raw.Positions), put, te) {
			dropped = append(dropped, words)
		}
	}
	// A tight end's own reception points beyond everyone's are the
	// tight end premium.
	if v, ok := te["CC"]; ok {
		host["bonus_rec_te"] = round2(v - host["rec"])
	}
	for key := range conflicts {
		delete(host, key)
		dropped = append(dropped, sources[key]...)
	}
	m := toRules(host)
	for _, key := range m.left {
		dropped = append(dropped, sources[key]...)
	}
	sort.Strings(dropped)
	return Scoring{Rules: m.rules, Dropped: dedupe(dropped), Defaulted: m.defaulted}
}

// dedupe is a sorted list with repeats taken out.
func dedupe(sorted []string) []string {
	out := make([]string, 0, len(sorted))
	for i, v := range sorted {
		if i == 0 || v != sorted[i-1] {
			out = append(out, v)
		}
	}
	return out
}

// carry puts one rule into custom keys, and says whether it could.
func carry(r mflRule, kind string, put func(string, float64), te map[string]float64) bool {
	switch {
	case kind == "te" && r.Event == "CC" && r.perUnit && r.lo <= 0:
		te["CC"] = r.value
		return true
	case kind == "def" && allowedEvents()[r.Event] && !r.perUnit:
		key, ok := allowedTiers()[r.Range]
		if ok {
			put(key, r.value)
		}
		return ok
	case (kind == "k" || kind == "offense") && r.Event == "FG" && !r.perUnit && r.lo <= 0 && r.hi >= openEnded:
		// The same points for every made field goal.
		put("fgm", r.value)
		return true
	case (kind == "k" || kind == "offense") && r.Event == "FG" && !r.perUnit:
		keys, ok := fieldGoalTiers()[strings.TrimSpace(r.Range)]
		for _, k := range keys {
			put(k, r.value)
		}
		return ok
	case kind == "te" || kind == "other":
		return false
	case r.perUnit && r.lo <= 0:
		key, ok := perUnit()[r.Event]
		if ok {
			put(key, r.value)
		}
		// #T counts defensive and special teams touchdowns alike.
		if r.Event == "#T" {
			put("st_td", r.value)
		}
		return ok
	case !r.perUnit && r.hi >= openEnded:
		key, ok := yardBonuses()[fmt.Sprintf("%s/%d", r.Event, r.lo)]
		if ok {
			put(key, r.value)
		}
		return ok
	}
	return false
}

// ruleWords is a dropped rule in the league's own terms: "FG 31-99 *.1 (PK)".
func ruleWords(r mfl.Rule) string {
	return cleanHostText(fmt.Sprintf("%s %s %s (%s)", r.Event, r.Range, r.Points, strings.ReplaceAll(r.Positions, "|", " ")))
}

// mflShape counts the league's lineup from its starter limits: each
// position's minimum starts, and the starts left over are flex spots,
// a superflex when a quarterback may fill one.
func mflShape(l mfl.League) Shape {
	s := Shape{Teams: len(l.Franchises)}
	minSum := 0
	qbFlexes := false
	unfollowed := map[string]bool{}
	for _, p := range l.StarterLimits {
		minSum += p.Min
		switch p.Position {
		case "QB":
			s.QB = p.Min
			qbFlexes = p.Max > p.Min
		case "RB":
			s.RB = p.Min
		case "WR":
			s.WR = p.Min
		case "TE":
			s.TE = p.Min
		case "PK":
			s.K = p.Min
		case "Def":
			s.DEF = p.Min
		default:
			if slot := cleanHostText(p.Position); p.Max > 0 && slot != "" {
				unfollowed[slot] = true
			}
		}
	}
	flex := l.Starters - minSum
	switch {
	case flex < 0:
		unfollowed[fmt.Sprintf("%d starters for %d minimum spots", l.Starters, minSum)] = true
	case qbFlexes && flex > 0:
		s.SuperFlex, s.Flex = 1, flex-1
	default:
		s.Flex = flex
	}
	s.Bench = l.RosterSize - l.Starters
	if s.Bench < 0 {
		s.Bench = 0
	}
	s.Unfollowed = sortedKeys(unfollowed)
	return s
}
