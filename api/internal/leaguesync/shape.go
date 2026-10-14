package leaguesync

import (
	"sort"
	"strings"

	"github.com/jhunthrop/commish/api/internal/scoring"
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
			if slot := cleanHostText(strings.ToUpper(p)); slot != "" {
				unfollowed[slot] = true
			}
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
// sleeperScoring maps the league's scoring_settings to ScoringRules
// (rules.go), naming every setting that does not land there, and any
// figure outside the saved league's bounds, by its key and figure.
func sleeperScoring(settings map[string]float64) Scoring {
	im := scoring.FromSleeper(settings)
	return Scoring{Rules: im.Rules, Dropped: im.Dropped, Defaulted: im.Defaulted}
}
