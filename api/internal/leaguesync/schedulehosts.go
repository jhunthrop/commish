package leaguesync

import (
	"context"
	"sort"

	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// The three hosts whose league read carries no season schedule read their
// weeks apart (Lane 298, schedulekeep.go). A week before the league's
// current one is final; the current week and those after carry pairings
// alone, whatever points the host shows for them so far.

// playedBefore reports whether a week is past: before the league's
// current week, or any week of a season the host has closed.
func playedBefore(snap Snapshot, week int) bool {
	return week < snap.Week || snap.Status == StatusComplete
}

// ReadWeeks is each week's matchups (/league/{id}/matchups/{week}), one
// request a week; in a league that plays the median, a game against it
// for every team.
func (s *Sleeper) ReadWeeks(ctx context.Context, snap Snapshot, weeks []int) ([]ScheduledGame, error) {
	var out []ScheduledGame
	for _, week := range weeks {
		matchups, err := s.API.Matchups(ctx, snap.Ref.LeagueID, week)
		if err != nil {
			return nil, sleeperErr("schedule matchups", err)
		}
		out = append(out, sleeperWeek(matchups, week, playedBefore(snap, week), snap.Terms.MedianGame)...)
	}
	return out, nil
}

// sleeperWeek pairs a week's sides by matchup id; a side with none is a
// bye.
func sleeperWeek(matchups []sleeper.Matchup, week int, final, median bool) []ScheduledGame {
	byGame := map[int][]sleeper.Matchup{}
	var games []int
	var out []ScheduledGame
	for _, m := range matchups {
		if m.MatchupID == 0 {
			out = append(out, scheduled(week, final, AgainstTeam, m))
			continue
		}
		if _, ok := byGame[m.MatchupID]; !ok {
			games = append(games, m.MatchupID)
		}
		byGame[m.MatchupID] = append(byGame[m.MatchupID], m)
	}
	sort.Ints(games)
	for _, id := range games {
		out = append(out, scheduled(week, final, AgainstTeam, byGame[id]...))
	}
	if median {
		for _, m := range matchups {
			out = append(out, scheduled(week, final, AgainstMedian, m))
		}
	}
	return out
}

// scheduled is one game of the sides, scored when final.
func scheduled(week int, final bool, against string, sides ...sleeper.Matchup) ScheduledGame {
	g := ScheduledGame{Week: week, Final: final, Against: against}
	for _, m := range sides {
		g.RosterIDs = append(g.RosterIDs, m.RosterID)
		if final {
			g.Points = append(g.Points, round2(m.Points))
		}
	}
	return g
}

// ReadWeeks is each week's scoreboard (league/{key}/scoreboard;week=N),
// one request a week, as the account the league is read for. A game Yahoo
// has scored final (postevent) is final.
func (y *Yahoo) ReadWeeks(ctx context.Context, snap Snapshot, weeks []int) ([]ScheduledGame, error) {
	boards, err := y.Member.Scoreboards(ctx, snap.Ref.As, snap.Ref.Season, snap.Ref.LeagueID, weeks)
	if err != nil {
		return nil, yahooErr(err)
	}
	var out []ScheduledGame
	for _, b := range boards {
		out = append(out, yahooWeek(b)...)
	}
	return out, nil
}

func yahooWeek(b yahoo.Scoreboard) []ScheduledGame {
	out := make([]ScheduledGame, 0, len(b.Games))
	for _, g := range b.Games {
		game := ScheduledGame{Week: b.Week, RosterIDs: []int{g.TeamIDs[0], g.TeamIDs[1]}, Final: g.Final}
		if g.Final {
			game.Points = []float64{round2(g.Points[0]), round2(g.Points[1])}
		}
		out = append(out, game)
	}
	return out
}

// ReadWeeks is the season's schedule export (TYPE=schedule): every week
// in one request, whatever weeks are asked. A game against the week's
// average (AVG) is kept as one.
func (m *MFL) ReadWeeks(ctx context.Context, snap Snapshot, _ []int) ([]ScheduledGame, error) {
	games, err := m.API.Schedule(ctx, snap.Ref.Season, snap.Ref.LeagueID)
	if err != nil {
		return nil, mflErr("schedule", err)
	}
	out := make([]ScheduledGame, 0, len(games))
	for _, g := range games {
		out = append(out, mflGame(snap, g))
	}
	return out, nil
}

func mflGame(snap Snapshot, g mfl.ScheduleGame) ScheduledGame {
	game := ScheduledGame{Week: g.Week, RosterIDs: g.Franchises, Final: playedBefore(snap, g.Week) && g.Scores != nil}
	if g.Average {
		game.Against = AgainstAverage
	}
	if game.Final {
		for _, v := range g.Scores {
			game.Points = append(game.Points, round2(v))
		}
	}
	return game
}
