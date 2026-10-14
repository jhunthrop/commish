package scoring

import (
	"fmt"
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
	Dropped   []string
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
		"bonus_rec_te": TEBonus, "fgm": "points_per_field_goal", "xpm": "points_per_extra_point",
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
	for k := range host {
		if !used[k] {
			out.Left = append(out.Left, k)
		}
	}
	sort.Strings(out.Left)
	for _, r := range rules {
		if _, ok := out.Rules[r.Key]; !ok {
			out.Rules[r.Key] = r.Standard
			out.Defaulted = append(out.Defaulted, fmt.Sprintf("%s %g", r.Key, r.Standard))
		}
	}
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
	var dropped []string
	for k, v := range settings {
		if !settingKey.MatchString(k) || math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > MaxPoints {
			dropped = append(dropped, HostText(fmt.Sprintf("%s %g", k, v)))
			continue
		}
		host[k] = v
	}
	m := MapSleeperNames(host)
	for _, k := range m.Left {
		if host[k] != 0 {
			dropped = append(dropped, fmt.Sprintf("%s %g", k, host[k]))
		}
	}
	sort.Strings(dropped)
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
