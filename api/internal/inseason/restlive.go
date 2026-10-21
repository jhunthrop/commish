package inseason

import (
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The rest of season at the read's clock (Lane 86, the sweep's Z3). A
// rest of season counts a club's games left by the one game
// state (gameStateAt): once a club's game kicks off it is no game left,
// so its players start from the club's next week while the board starts
// from the first week with any game left. The nightly writes its points
// once a night, at its own instant; between that run and the next the
// read takes the games played since out of them, the run's points a game
// times the games still to play now, as the game state replaces the
// run's.

// RestNow is the rest of season at a read's clock.
type RestNow struct {
	// Left is each club's games left at the read's clock through the
	// horizon's last week, and Run each club's at the run's instant
	// through the run's own last week (RunThrough), both from the run's
	// first week. Within is Left's games through the run's last week and
	// After its games past it (Lane 96): the run's points cover the first,
	// each player's points for one more game value the second.
	Left, Run, Within, After map[string]int
	// FromWeek is the earliest week with a game still to play, 0 with none.
	FromWeek int
	// Partial is set while a game of FromWeek has kicked off: the week's
	// games still to play are what the order counts of it.
	Partial bool
	from    map[string]int
}

// From is the week a club's rest of season starts from: its first game
// still to play, 0 with none left.
func (r RestNow) From(team string) int { return r.from[team] }

// weeksToPlay is each club's weeks from first through last whose game is
// still upcoming at at, in order: the one rule the order, the player read
// and their words count the rest of season by.
func weeksToPlay(games []boards.TeamWeek, first, last int, at time.Time) map[string][]int {
	out := map[string][]int{}
	for _, g := range games {
		if g.Week >= first && g.Week <= last && gameStateAt(g, at) == apitypes.GameStateUpcoming {
			out[g.Team] = append(out[g.Team], g.Week)
		}
	}
	for team := range out {
		sort.Ints(out[team])
	}
	return out
}

// beforeFinals is the schedule as it stood before any result: a final
// never precedes its kickoff, so at the run's instant the kickoff alone
// says which games were still to play.
func beforeFinals(games []boards.TeamWeek) []boards.TeamWeek {
	out := make([]boards.TeamWeek, len(games))
	for i, g := range games {
		g.Final = false
		out[i] = g
	}
	return out
}

func counts(weeks map[string][]int) map[string]int {
	out := make(map[string]int, len(weeks))
	for team, w := range weeks {
		out[team] = len(w)
	}
	return out
}

// RunThrough is the last week a run's points count from its first week:
// LastWeek, or once the season is past it the run's own first week (a
// week 18 run ranks week 18, research.model.ros.live counted_through).
func RunThrough(first int) int { return max(LastWeek, first) }

// RestAt is the rest of season at now through h's last week, for a run
// made at run whose points cover its first week (published_boards.from_week)
// through RunThrough.
func RestAt(games []boards.TeamWeek, first int, run, now time.Time, h Horizon) RestNow {
	runLast := RunThrough(first)
	left := weeksToPlay(games, first, h.Last, now)
	rest := RestNow{Left: counts(left), Run: counts(weeksToPlay(beforeFinals(games), first, runLast, run)),
		Within: counts(weeksToPlay(games, first, min(h.Last, runLast), now)), After: map[string]int{}, from: map[string]int{}}
	for team, weeks := range left {
		for _, w := range weeks {
			if w > runLast {
				rest.After[team]++
			}
		}
	}
	for team, weeks := range left {
		rest.from[team] = weeks[0]
		if rest.FromWeek == 0 || weeks[0] < rest.FromWeek {
			rest.FromWeek = weeks[0]
		}
	}
	for _, g := range games {
		if g.Week == rest.FromWeek && gameStateAt(g, now) != apitypes.GameStateUpcoming {
			rest.Partial = true
		}
	}
	return rest
}

// LiveBoard is the board at rest's clock: on a rest-of-season order that
// says its first week, each player's points over his club's games still
// to play now through the horizon, valued again, and the first week the
// earliest with a game left (the run's while none is known). Any other
// board is returned as it is.
//
// The games through the run's last week are the run's points a game times
// them; the games past it (a title week 18 against the run's 17, Lane 96
// review H1) his points for one more game times them, whether or not his
// club had a game left at the run. A run older than game_points values
// every game left at the run's points a game, and a club with none left
// at the run keeps the run's points.
func LiveBoard(b boards.Board, rest RestNow) (boards.Board, error) {
	if !carriesPerGame(b) {
		return b, nil
	}
	points := map[string]float64{}
	for _, p := range b.Raw.Players {
		if v, ok := livePoints(p, rest); ok {
			points[p.ID] = v
		}
	}
	live, err := b.Rescaled(points)
	if err != nil {
		return boards.Board{}, err
	}
	if rest.FromWeek > 0 {
		// The run's first week stands while the schedule holds no game left.
		live.FromWeek = rest.FromWeek
	}
	return live, nil
}

// livePoints is one player's points at rest's clock, false to keep the
// run's (LiveBoard).
func livePoints(p boards.Player, rest RestNow) (float64, bool) {
	if p.Points == nil {
		return 0, false
	}
	if p.Team == "" {
		// A free agent (no club, Lane 123) has no game left to count, his
		// one more game (game_points) among them (Lane 127, B103).
		return 0, true
	}
	run := rest.Run[p.Team]
	if p.GamePoints == nil {
		if run == 0 {
			return 0, false
		}
		return *p.Points * float64(rest.Left[p.Team]) / float64(run), true
	}
	within := 0.0
	if run > 0 {
		within = *p.Points * float64(rest.Within[p.Team]) / float64(run)
	}
	return within + *p.GamePoints*float64(rest.After[p.Team]), true
}
