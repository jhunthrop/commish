package leaguesync

import (
	"context"
	"embed"
	"errors"
	"fmt"

	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// The development replay (COMPANION_REPLAY, the companion's flag,
// refused in production by internal/config): two real 2026 leagues as
// their hosts answered on 2026-10-13, so the league page is built and
// shot without a live league. Pasting a recorded league's link reads
// the recording; any other league is read live. The directories are cut
// to the players the recordings name.
//
//   - Sleeper 1382163311038038016, "S.U.C.K. - Severely Underrated
//     Carolina Keepers", 12 teams, two flex, no kicker, week 6.
//   - MyFantasyLeague 2026 league 10010, "Apex Amateur Dynasty 203", a
//     public 12-team league, week 6.
//
//go:embed replay/sleeper/*.json replay/mfl/*.json
var replayFiles embed.FS

// Recorded leagues.
const (
	ReplaySleeperLeague = "1382163311038038016"
	ReplayMFLLeague     = "10010"
	ReplayMFLSeason     = 2026
)

func replayFile(name string) []byte {
	b, err := replayFiles.ReadFile("replay/" + name)
	if err != nil {
		panic(fmt.Sprintf("leaguesync: replay file %s: %v", name, err))
	}
	return b
}

// SleeperReplay answers the recorded league from its recording and
// everything else from the live client.
type SleeperReplay struct {
	Live SleeperAPI
}

func (r SleeperReplay) recorded(id string) bool { return id == ReplaySleeperLeague }

// League reads the recording for the recorded league.
func (r SleeperReplay) League(ctx context.Context, id string) (sleeper.League, error) {
	if r.recorded(id) {
		return sleeper.DecodeLeague(replayFile("sleeper/league.json"), id)
	}
	return r.Live.League(ctx, id)
}

// Rosters reads the recording for the recorded league.
func (r SleeperReplay) Rosters(ctx context.Context, id string) ([]sleeper.Roster, error) {
	if r.recorded(id) {
		return sleeper.DecodeRosters(replayFile("sleeper/rosters.json"))
	}
	return r.Live.Rosters(ctx, id)
}

// LeagueUsers reads the recording for the recorded league.
func (r SleeperReplay) LeagueUsers(ctx context.Context, id string) ([]sleeper.User, error) {
	if r.recorded(id) {
		return sleeper.DecodeUsers(replayFile("sleeper/users.json"))
	}
	return r.Live.LeagueUsers(ctx, id)
}

// Matchups reads the recording (week 6) for the recorded league.
func (r SleeperReplay) Matchups(ctx context.Context, id string, week int) ([]sleeper.Matchup, error) {
	if r.recorded(id) {
		return sleeper.DecodeMatchups(replayFile("sleeper/matchups.json"))
	}
	return r.Live.Matchups(ctx, id, week)
}

// Transactions reads the recording for the recorded league: its week 6
// for the current week, its week 5 for any other.
func (r SleeperReplay) Transactions(ctx context.Context, id string, week int) ([]sleeper.Transaction, error) {
	if !r.recorded(id) {
		return r.Live.Transactions(ctx, id, week)
	}
	state, err := r.NFLState(ctx)
	if err != nil {
		return nil, err
	}
	if week == state.Week {
		return sleeper.DecodeTransactions(replayFile("sleeper/transactions_this.json"))
	}
	return sleeper.DecodeTransactions(replayFile("sleeper/transactions_last.json"))
}

// NFLState is live, so a live league in the same process reads its true
// week; the recording's when the host does not answer. The recorded
// league answers its week 6 matchups whatever the week.
func (r SleeperReplay) NFLState(ctx context.Context) (sleeper.State, error) {
	if st, err := r.Live.NFLState(ctx); err == nil {
		return st, nil
	}
	return sleeper.DecodeState(replayFile("sleeper/state.json"))
}

// Draft is live: the recorded league is past its draft, so its draft is
// never read.
func (r SleeperReplay) Draft(ctx context.Context, id string) (sleeper.Draft, error) {
	return r.Live.Draft(ctx, id)
}

// UserID is live: a username is the drafter's own.
func (r SleeperReplay) UserID(ctx context.Context, username string) (string, error) {
	return r.Live.UserID(ctx, username)
}

// Players is the live directory, or the recording's cut of it when the
// host does not answer.
func (r SleeperReplay) Players(ctx context.Context) ([]sleeper.Player, error) {
	if ps, err := r.Live.Players(ctx); err == nil {
		return ps, nil
	}
	return sleeper.DecodePlayers(replayFile("sleeper/players.json"))
}

// MFLReplay answers the recorded league from its recording and
// everything else from the live client.
type MFLReplay struct {
	Live MFLAPI
}

func (r MFLReplay) recorded(season int, id string) bool {
	return season == ReplayMFLSeason && id == ReplayMFLLeague
}

// League reads the recording for the recorded league.
func (r MFLReplay) League(ctx context.Context, season int, id string) (mfl.League, error) {
	if r.recorded(season, id) {
		return mfl.DecodeLeague(replayFile("mfl/league.json"), season, id)
	}
	return r.Live.League(ctx, season, id)
}

// Rosters reads the recording for the recorded league.
func (r MFLReplay) Rosters(ctx context.Context, season int, id string) ([]mfl.Roster, error) {
	if r.recorded(season, id) {
		return mfl.DecodeRosters(replayFile("mfl/rosters.json"))
	}
	return r.Live.Rosters(ctx, season, id)
}

// Rules reads the recording for the recorded league.
func (r MFLReplay) Rules(ctx context.Context, season int, id string) ([]mfl.Rule, error) {
	if r.recorded(season, id) {
		return mfl.DecodeRules(replayFile("mfl/rules.json"))
	}
	return r.Live.Rules(ctx, season, id)
}

// Standings reads the recording for the recorded league.
func (r MFLReplay) Standings(ctx context.Context, season int, id string) ([]mfl.Standing, error) {
	if r.recorded(season, id) {
		return mfl.DecodeStandings(replayFile("mfl/standings.json"))
	}
	return r.Live.Standings(ctx, season, id)
}

// LiveScoring reads the recording (week 6) for the recorded league.
func (r MFLReplay) LiveScoring(ctx context.Context, season int, id string, week int) ([]mfl.Matchup, error) {
	if r.recorded(season, id) {
		return mfl.DecodeLiveScoring(replayFile("mfl/live.json"))
	}
	return r.Live.LiveScoring(ctx, season, id, week)
}

// Transactions reads the recording for the recorded league: the moves of
// its last fourteen days as this week's, none as last week's.
func (r MFLReplay) Transactions(ctx context.Context, season int, id string, week int) ([]mfl.Transaction, error) {
	if !r.recorded(season, id) {
		return r.Live.Transactions(ctx, season, id, week)
	}
	status, err := r.SeasonStatus(ctx, season)
	if err != nil || week != status.CurrentWeek {
		return nil, err
	}
	return mfl.DecodeTransactions(replayFile("mfl/transactions.json"))
}

// errNotRecorded is a part of the recorded league its recording lacks.
var errNotRecorded = errors.New("leaguesync: replay: not recorded")

// DraftResults: the recording has none for the recorded league, so its
// draft reads as unstated, as a league whose results do not answer.
func (r MFLReplay) DraftResults(ctx context.Context, season int, id string) (mfl.DraftResults, error) {
	if r.recorded(season, id) {
		return mfl.DraftResults{}, errNotRecorded
	}
	return r.Live.DraftResults(ctx, season, id)
}

// Schedule reads the recording (2026-10-29, weeks 1 to 7 played) for the
// recorded league.
func (r MFLReplay) Schedule(ctx context.Context, season int, id string) ([]mfl.ScheduleGame, error) {
	if r.recorded(season, id) {
		return mfl.DecodeSchedule(replayFile("mfl/schedule.json"))
	}
	return r.Live.Schedule(ctx, season, id)
}

// SeasonStatus is the recording's for the recorded season.
func (r MFLReplay) SeasonStatus(ctx context.Context, season int) (mfl.Status, error) {
	if season == ReplayMFLSeason {
		return mfl.DecodeStatus(replayFile("mfl/status.json"))
	}
	return r.Live.SeasonStatus(ctx, season)
}

// Players is the live directory, or the recording's cut of it when the
// host does not answer.
func (r MFLReplay) Players(ctx context.Context, season int) ([]mfl.Player, error) {
	if ps, err := r.Live.Players(ctx, season); err == nil {
		return ps, nil
	}
	return mfl.DecodePlayers(replayFile("mfl/players.json"))
}
