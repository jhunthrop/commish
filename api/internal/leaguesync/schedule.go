package leaguesync

import (
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// What a scheduled game is played against (Lane 298): another team, the
// whole field (an all-play week), the week's median score, or the week's
// average score.
const (
	// AgainstTeam is a head-to-head game; a game with one roster and no
	// opponent is that team's bye.
	AgainstTeam = ""
	// AgainstField is an all-play week as FFPC's rules score it: the top
	// half of the week's scores win, the rest lose, a tie at the cut wins.
	AgainstField = "field"
	// AgainstMedian is a game against the week's median score (Sleeper's
	// league_average_match).
	AgainstMedian = "median"
	// AgainstAverage is a game against the week's average score
	// (MyFantasyLeague's AVG franchise).
	AgainstAverage = "average"
)

// ScheduledGame is one game of the season, past or to come: the week, the
// rosters in it (two for a head-to-head game, one for a bye or a game
// against the field, the median or the average), each roster's points in
// the same order once read, and whether the host has scored the week.
//
// Points is nil where the host gave no score for the game (a week to come,
// or an FFPC all-play week, whose schedule lists no games). A final game
// with Points nil is played but unread.
type ScheduledGame struct {
	Week      int       `json:"week"`
	RosterIDs []int     `json:"roster_ids"`
	Points    []float64 `json:"points,omitempty"`
	Final     bool      `json:"final"`
	Against   string    `json:"against,omitempty"`
}

// Scored reports whether the game carries each roster's points.
func (g ScheduledGame) Scored() bool {
	return len(g.Points) == len(g.RosterIDs) && len(g.Points) > 0
}

// HeadToHead reports a game between two teams.
func (g ScheduledGame) HeadToHead() bool {
	return g.Against == AgainstTeam && len(g.RosterIDs) == 2
}

// espnSchedule is the read's regular-season matchups as the schedule.
func espnSchedule(games []espn.Scheduled) []ScheduledGame {
	out := make([]ScheduledGame, 0, len(games))
	for _, g := range games {
		game := ScheduledGame{Week: g.Period, RosterIDs: []int{g.Home}, Final: g.Final}
		if g.Away > 0 {
			game.RosterIDs = append(game.RosterIDs, g.Away)
		}
		if g.Final {
			game.Points = []float64{round2(g.HomePoints)}
			if g.Away > 0 {
				game.Points = append(game.Points, round2(g.Points))
			}
		}
		out = append(out, game)
	}
	return sortSchedule(out)
}

// ffpcSchedule is the schedule page's weeks as the schedule: each listed
// game away side first, and an all-play week as a game against the field
// for every team, unscored (the page lists no scores for it). A week
// before the league's current one is final; with no current week, a week
// whose dates are past.
func ffpcSchedule(weeks []ffpc.Week, teams []Team, current int, now time.Time) []ScheduledGame {
	var out []ScheduledGame
	for _, w := range weeks {
		final := w.Number < current || (current == 0 && !w.Ends.IsZero() && now.After(w.Ends.AddDate(0, 0, 1)))
		if w.AllPlay && len(w.Games) == 0 {
			for _, t := range teams {
				out = append(out, ScheduledGame{Week: w.Number, RosterIDs: []int{t.RosterID}, Final: final, Against: AgainstField})
			}
			continue
		}
		for _, g := range w.Games {
			game := ScheduledGame{Week: w.Number, RosterIDs: []int{g.Away, g.Home}, Final: final}
			if final {
				game.Points = []float64{round2(g.AwayPoints), round2(g.HomePoints)}
			}
			out = append(out, game)
		}
	}
	return sortSchedule(out)
}

// sortSchedule orders the games by week, then by their first roster.
func sortSchedule(games []ScheduledGame) []ScheduledGame {
	sort.SliceStable(games, func(i, j int) bool {
		a, b := games[i], games[j]
		if a.Week != b.Week {
			return a.Week < b.Week
		}
		return a.RosterIDs[0] < b.RosterIDs[0]
	})
	return games
}

// WeekScores is each roster's points in the week by roster id, from the
// week's scored games; a roster counts once (a game against the median
// repeats its head-to-head points).
func WeekScores(games []ScheduledGame, week int) map[int]float64 {
	out := map[int]float64{}
	for _, g := range games {
		if g.Week != week || !g.Final || !g.Scored() {
			continue
		}
		for i, id := range g.RosterIDs {
			if _, seen := out[id]; !seen {
				out[id] = g.Points[i]
			}
		}
	}
	return out
}

// Weeks is the schedule's weeks, in order.
func Weeks(games []ScheduledGame) []int {
	seen := map[int]bool{}
	var out []int
	for _, g := range games {
		if !seen[g.Week] {
			seen[g.Week] = true
			out = append(out, g.Week)
		}
	}
	sort.Ints(out)
	return out
}
