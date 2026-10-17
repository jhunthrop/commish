package scoring

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Imported is a host's rules as ScoringRules: every rule (the ones the
// host does not state at the standard figure), the host settings the 21
// do not carry in the host's words with their figures, and the rules
// taken at the standard figure.
type Imported struct {
	Rules     map[string]float64
	Dropped   []DroppedRule
	Defaulted []string
}

// Applied is the rules the host states, by our names.
func (im Imported) Applied() []string {
	defaulted := map[string]bool{}
	for _, d := range im.Defaulted {
		defaulted[strings.Fields(d)[0]] = true
	}
	out := make([]string, 0, len(rules))
	for _, r := range rules {
		if !defaulted[r.Key] {
			out = append(out, r.Key)
		}
	}
	return out
}

// sleeperNames is each rule's one Sleeper setting (MyFantasyLeague's and
// FFPC's rules are put in these names first).
func sleeperNames() map[string]string {
	return map[string]string{
		"pass_yd": "points_per_passing_yard", "pass_td": "points_per_passing_touchdown", "pass_int": "points_per_interception",
		"rush_yd": "points_per_rushing_yard", "rush_td": "points_per_rushing_touchdown", "rec_yd": "points_per_receiving_yard",
		"rec_td": "points_per_receiving_touchdown", "rec": Reception, "fum_lost": "points_per_fumble_lost",
		"bonus_rec_te": TEBonus, "xpm": "points_per_extra_point",
		"sack": "points_per_sack", "int": "points_per_defensive_interception", "def_td": "points_per_defensive_touchdown",
		"fgmiss": "points_per_field_goal_missed", "xpmiss": "points_per_extra_point_missed",
		"fum_rec": "points_per_defensive_fumble_recovery", "safe": "points_per_safety",
	}
}

// alike is a rule taken from several settings only when every one the
// host states scores the same.
func alike() map[string][]string {
	return map[string][]string{
		"points_per_two_point_conversion": {"pass_2pt", "rush_2pt", "rec_2pt"},
		"points_per_return_touchdown":     {"kr_td", "pr_td"},
	}
}

// Sleeper scores a made field goal by its flat setting (fgm) and by its
// distance's range alike, adding the two as ESPN does: a setting a league
// does not state adds nothing. The short ranges carry the one under-40
// figure (points_per_field_goal) when they score alike, and each longer
// range its own rule. A miss carries one figure: the short ranges' when
// alike, and a longer range scoring differently is left out, named by the
// caller.
var (
	shortMade   = []string{"fgm_0_19", "fgm_20_29", "fgm_30_39"}
	longMade    = map[string]string{"fgm_40_49": FieldGoal40To49, "fgm_50p": FieldGoal50AndUp}
	shortMissed = []string{"fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39"}
	longMissed  = []string{"fgmiss_40_49", "fgmiss_50p"}
)

// madeByDistance reads made field goals: the flat setting plus each
// distance's range. When the short ranges score differently there is no
// one under-40 figure: it is left at the standard and the ranges named.
func madeByDistance(host, rules map[string]float64, used map[string]bool) {
	flat, flatStated := host["fgm"]
	stated := flatStated
	for _, k := range shortMade {
		_, ok := host[k]
		stated = stated || ok
	}
	for k := range longMade {
		_, ok := host[k]
		stated = stated || ok
	}
	if !stated {
		return
	}
	used["fgm"] = flatStated
	if short, ok := sameFigure(host, shortMade); ok {
		rules[FieldGoal] = flat + short
		for _, k := range shortMade {
			used[k] = true
		}
	} else if !anyStated(host, shortMade) {
		rules[FieldGoal] = flat
	}
	for hostKey, key := range longMade {
		v, ok := host[hostKey]
		rules[key], used[hostKey] = flat+v, ok
	}
}

// anyStated reports whether the host states any of the keys.
func anyStated(host map[string]float64, keys []string) bool {
	for _, k := range keys {
		if _, ok := host[k]; ok {
			return true
		}
	}
	return false
}

// missedByDistance reads one miss figure from the short ranges when the
// league states no flat one; a longer range scoring the same is taken with
// them.
func missedByDistance(host, rules map[string]float64, used map[string]bool) {
	const key = "points_per_field_goal_missed"
	if _, ok := rules[key]; ok {
		return
	}
	v, ok := sameFigure(host, shortMissed)
	if !ok {
		return
	}
	rules[key] = v
	for _, k := range shortMissed {
		used[k] = true
	}
	for _, k := range longMissed {
		if long, stated := host[k]; stated && long == v {
			used[k] = true
		}
	}
}

// bracket is a host's points-allowed or yards-allowed bracket.
type bracket struct {
	yards  bool
	lo, hi int
}

// sleeperBrackets is Sleeper's brackets by setting.
func sleeperBrackets() map[string]bracket {
	return map[string]bracket{
		"pts_allow_0": {false, 0, 0}, "pts_allow_1_6": {false, 1, 6}, "pts_allow_7_13": {false, 7, 13},
		"pts_allow_14_20": {false, 14, 20}, "pts_allow_21_27": {false, 21, 27}, "pts_allow_28_34": {false, 28, 34},
		"pts_allow_35p":   {false, 35, math.MaxInt},
		"yds_allow_0_100": {true, 0, 99}, "yds_allow_100_199": {true, 100, 199}, "yds_allow_200_299": {true, 200, 299},
		"yds_allow_300_349": {true, 300, 349}, "yds_allow_350_399": {true, 350, 399}, "yds_allow_400_449": {true, 400, 449},
		"yds_allow_450_499": {true, 450, 499}, "yds_allow_500_549": {true, 500, 549}, "yds_allow_550p": {true, 550, math.MaxInt},
	}
}

// tiersOf is the tiers a bracket spans.
func tiersOf(b bracket) ([]string, bool) {
	group := pointsAllowedTiers
	if b.yards {
		group = yardsAllowedTiers
	}
	return Cover(group, b.lo, b.hi, math.MaxInt)
}

// tiers takes each stated bracket into the tiers it spans, and a tier
// named by its own rule (a MyFantasyLeague bracket that is not Sleeper's).
func tiers(host, rules map[string]float64, used map[string]bool) {
	for name, b := range sleeperBrackets() {
		v, ok := host[name]
		if !ok {
			continue
		}
		keys, _ := tiersOf(b)
		for _, k := range keys {
			rules[k] = v
		}
		used[name] = true
	}
	for k, v := range host {
		if IsTier(k) {
			rules[k], used[k] = v, true
		}
	}
}

// Mapped is settings in Sleeper's names as ScoringRules: the rules, the
// settings the map left (for the caller to name in the host's words), and
// the rules taken at the standard figure.
type Mapped struct {
	Rules     map[string]float64
	Left      []string
	Defaulted []string
}

// MapSleeperNames maps settings in Sleeper's names to ScoringRules.
func MapSleeperNames(host map[string]float64) Mapped {
	out := Mapped{Rules: map[string]float64{}}
	used := map[string]bool{}
	for hostKey, key := range sleeperNames() {
		if v, ok := host[hostKey]; ok {
			out.Rules[key], used[hostKey] = v, true
		}
	}
	for key, hostKeys := range alike() {
		if v, ok := sameFigure(host, hostKeys); ok {
			out.Rules[key] = v
			for _, k := range hostKeys {
				used[k] = true
			}
		}
	}
	madeByDistance(host, out.Rules, used)
	missedByDistance(host, out.Rules, used)
	tiers(host, out.Rules, used)
	for k := range host {
		if !used[k] {
			out.Left = append(out.Left, k)
		}
	}
	sort.Strings(out.Left)
	out.Defaulted = Complete(out.Rules)
	return out
}

// sameFigure is the one figure every stated setting scores, false when
// none is stated or two differ.
func sameFigure(host map[string]float64, keys []string) (float64, bool) {
	var figure float64
	stated := false
	for _, k := range keys {
		v, ok := host[k]
		if !ok {
			continue
		}
		if stated && v != figure {
			return 0, false
		}
		figure, stated = v, true
	}
	return figure, stated
}

var settingKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// FromSleeper is a Sleeper league's scoring_settings as ScoringRules,
// naming every setting that does not land in the 21, and any figure out
// of bounds, by its key and figure. A setting of 0 scores nothing, so
// leaving it loses nothing and it is not named.
func FromSleeper(settings map[string]float64) Imported {
	host := map[string]float64{}
	var dropped []DroppedRule
	for k, v := range settings {
		if !settingKey.MatchString(k) || math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > MaxPoints {
			dropped = append(dropped, sleeperDropped(k, v))
			continue
		}
		host[k] = v
	}
	m := MapSleeperNames(host)
	for _, k := range m.Left {
		if host[k] == 0 {
			continue
		}
		dropped = append(dropped, sleeperDropped(k, host[k]))
	}
	SortDropped(dropped)
	return Imported{Rules: m.Rules, Dropped: dropped, Defaulted: m.Defaulted}
}

// MaxHostText bounds one host phrase we repeat.
const MaxHostText = 80

// HostText is a host's own words made safe to repeat: no control or
// format characters, at most 80 runes.
func HostText(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if r := []rune(s); len(r) > MaxHostText {
		s = string(r[:MaxHostText])
	}
	return s
}
