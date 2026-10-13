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

const (
	maxCustomPoints = 100
	maxCustomStats  = 200
)

// sleeperScoring is the league's scoring_settings as the saved league's
// custom rules, word for word: Sleeper's stat keys are the keys the
// custom-scoring path reads. A key or a figure outside the saved
// league's bounds is named in Dropped, never silently lost.
func sleeperScoring(settings map[string]float64) Scoring {
	out := Scoring{Rules: map[string]float64{}}
	keys := make([]string, 0, len(settings))
	for k := range settings {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := settings[k]
		switch {
		case !customKey.MatchString(k), math.IsNaN(v), math.Abs(v) > maxCustomPoints, len(out.Rules) >= maxCustomStats:
			out.Dropped = append(out.Dropped, fmt.Sprintf("%.40s %g", k, v))
		default:
			out.Rules[k] = v
		}
	}
	return out
}
