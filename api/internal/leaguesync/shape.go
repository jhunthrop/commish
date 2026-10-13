package leaguesync

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Sleeper's roster_positions names, by the slot each fills.
const (
	posQB        = "QB"
	posRB        = "RB"
	posWR        = "WR"
	posTE        = "TE"
	posK         = "K"
	posDEF       = "DEF"
	posFlex      = "FLEX"
	posSuperFlex = "SUPER_FLEX"
	posBench     = "BN"
	posReserve   = "IR"
	posTaxi      = "TAXI"
)

// sleeperShape counts the league's lineup. A slot outside the rooms'
// roster is named in Unfollowed rather than guessed at.
func sleeperShape(l sleeper.League) Shape {
	s := Shape{Teams: l.TotalRosters}
	unfollowed := map[string]bool{}
	for _, p := range l.RosterPositions {
		switch strings.ToUpper(p) {
		case posQB:
			s.QB++
		case posRB:
			s.RB++
		case posWR:
			s.WR++
		case posTE:
			s.TE++
		case posK:
			s.K++
		case posDEF:
			s.DEF++
		case posFlex:
			s.Flex++
		case posSuperFlex:
			s.SuperFlex++
		case posBench:
			s.Bench++
		case posReserve, posTaxi:
		default:
			unfollowed[strings.ToUpper(p)] = true
		}
	}
	s.Unfollowed = sortedKeys(unfollowed)
	return s
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// The saved league's custom scoring bounds (leagues.Validate): a stat
// key is snake_case, points stay within 100 either way, 200 stats at most.
var customKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

const maxCustomPoints = 100

// sleeperScoring maps the league's scoring_settings to ScoringRules
// (rules.go), naming every setting that does not land there, and any
// figure outside the saved league's bounds, by its key and figure.
func sleeperScoring(settings map[string]float64) Scoring {
	host := map[string]float64{}
	var dropped []string
	for k, v := range settings {
		if !customKey.MatchString(k) || math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > maxCustomPoints {
			dropped = append(dropped, cleanHostText(fmt.Sprintf("%s %g", k, v)))
			continue
		}
		host[k] = v
	}
	m := toRules(host)
	for _, k := range m.left {
		dropped = append(dropped, fmt.Sprintf("%s %g", k, host[k]))
	}
	sort.Strings(dropped)
	return Scoring{Rules: m.rules, Dropped: dropped, Defaulted: m.defaulted}
}
