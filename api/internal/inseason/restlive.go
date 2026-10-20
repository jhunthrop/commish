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
	// through LastWeek, the run's own, both from the run's first week.
	Left, Run map[string]int
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

// RestAt is the rest of season at now through h's last week, for a run
// made at run whose points cover its first week (published_boards.from_week)
// through LastWeek.
func RestAt(games []boards.TeamWeek, first int, run, now time.Time, h Horizon) RestNow {
	left := weeksToPlay(games, first, h.Last, now)
	rest := RestNow{Left: counts(left), Run: counts(weeksToPlay(beforeFinals(games), first, LastWeek, run)), from: map[string]int{}}
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
// to play now through the horizon (the run's points a game times them),
// valued again, and the
// first week the earliest with a game left (the run's while none is
// known). Any other board is returned
// as it is.
func LiveBoard(b boards.Board, rest RestNow) (boards.Board, error) {
	if !carriesPerGame(b) {
		return b, nil
	}
	points := map[string]float64{}
	for _, p := range b.Raw.Players {
		run := rest.Run[p.Team]
		if p.Points == nil || run == 0 {
			continue
		}
		points[p.ID] = *p.Points * float64(rest.Left[p.Team]) / float64(run)
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
