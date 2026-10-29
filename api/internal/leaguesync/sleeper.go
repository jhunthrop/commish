package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// SleeperAPI is the part of *sleeper.Client a league read needs; the
// replay fixture implements it too.
type SleeperAPI interface {
	League(ctx context.Context, id string) (sleeper.League, error)
	Rosters(ctx context.Context, leagueID string) ([]sleeper.Roster, error)
	LeagueUsers(ctx context.Context, leagueID string) ([]sleeper.User, error)
	Matchups(ctx context.Context, leagueID string, week int) ([]sleeper.Matchup, error)
	Transactions(ctx context.Context, leagueID string, week int) ([]sleeper.Transaction, error)
	NFLState(ctx context.Context) (sleeper.State, error)
	UserID(ctx context.Context, username string) (string, error)
	Players(ctx context.Context) ([]sleeper.Player, error)
	Draft(ctx context.Context, id string) (sleeper.Draft, error)
}

// stateTTL is how long the NFL's week is kept: it is one read for every
// league, so it is shared.
const stateTTL = time.Minute

// Sleeper is the Sleeper host.
type Sleeper struct {
	API SleeperAPI
	Now func() time.Time
	// Log is where a failed draft read is said, nil for none.
	Log *slog.Logger
	// Season is the site's season: the NFL state's week counts only
	// once the season is past the preseason. Nil takes the week as is.
	Season SiteSeason

	mu      sync.Mutex
	state   sleeper.State
	stateAt time.Time
}

// Key is the host's contract name.
func (s *Sleeper) Key() string { return HostSleeper }

// Owns reports a sleeper.com or sleeper.app address.
func (s *Sleeper) Owns(pasted string) bool { return sleeper.IsLink(pasted) }

// Parse reads the league id from a link or a bare id.
func (s *Sleeper) Parse(pasted string) (Ref, error) {
	id, err := sleeper.ParseLeagueLink(pasted)
	if err != nil {
		return Ref{}, ErrNotALink
	}
	return Ref{Host: HostSleeper, LeagueID: id}, nil
}

func sleeperErr(what string, err error) error {
	switch {
	case errors.Is(err, sleeper.ErrNotFound):
		return fmt.Errorf("%w: %s: %v", ErrNotFound, what, err)
	default:
		return fmt.Errorf("%w: %s: %v", ErrUnavailable, what, err)
	}
}

func (s *Sleeper) nflState(ctx context.Context) (sleeper.State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.Now()
	if !s.stateAt.IsZero() && now.Sub(s.stateAt) < stateTTL {
		return s.state, nil
	}
	st, err := s.API.NFLState(ctx)
	if err != nil {
		return sleeper.State{}, sleeperErr("state", err)
	}
	s.state, s.stateAt = st, now
	return st, nil
}

// Read is one whole read: the league, its rosters and members, the
// week's matchups and the moves of this week and last.
func (s *Sleeper) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	league, err := s.API.League(ctx, ref.LeagueID)
	if err != nil {
		return Snapshot{}, sleeperErr("league", err)
	}
	rosters, err := s.API.Rosters(ctx, ref.LeagueID)
	if err != nil {
		return Snapshot{}, sleeperErr("rosters", err)
	}
	users, err := s.API.LeagueUsers(ctx, ref.LeagueID)
	if err != nil {
		return Snapshot{}, sleeperErr("users", err)
	}
	state, err := s.nflState(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{
		Ref: ref, Name: league.Name, Status: league.Status, Season: league.Season,
		Teams: sleeperTeams(rosters, users, league), Scoring: sleeperScoring(league.Scoring), Terms: sleeperTerms(league),
		Shape: sleeperShape(league), ReadAt: s.Now(),
		Calendar: Calendar{PlayoffStartWeek: league.PlayoffWeekStart, WaiversClosed: league.AddsDisabled},
	}
	snap.Calendar.DraftAt = s.draftTime(ctx, league)
	if league.Season == state.Season && league.Status != sleeper.LeaguePreDraft && state.Week >= 1 && !s.preseason(ctx) {
		snap.Week = state.Week
	}
	if snap.Week == 0 {
		return snap, nil
	}
	if snap.Matchups, snap.Moves, err = s.week(ctx, ref.LeagueID, snap.Week); err != nil {
		return Snapshot{}, err
	}
	return snap, nil
}

// week is the week's matchups and the moves of this week and last.
func (s *Sleeper) week(ctx context.Context, leagueID string, week int) ([]Side, []Move, error) {
	matchups, err := s.API.Matchups(ctx, leagueID, week)
	if err != nil {
		return nil, nil, sleeperErr("matchups", err)
	}
	sides := make([]Side, 0, len(matchups))
	for _, m := range matchups {
		sides = append(sides, Side{RosterID: m.RosterID, Game: m.MatchupID, Points: round2(m.Points), Starters: starters(m.Starters), PlayerPoints: m.PlayerPoints})
	}
	var moves []Move
	for _, w := range []int{week, week - 1} {
		if w < 1 {
			continue
		}
		txs, err := s.API.Transactions(ctx, leagueID, w)
		if err != nil {
			return nil, nil, sleeperErr("transactions", err)
		}
		moves = append(moves, sleeperMoves(txs)...)
	}
	sort.SliceStable(moves, func(i, j int) bool { return moves[i].At.After(moves[j].At) })
	return sides, moves, nil
}

// starters drops Sleeper's "0", an empty starting slot.
func starters(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != "0" {
			out = append(out, id)
		}
	}
	return out
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func sleeperTeams(rosters []sleeper.Roster, users []sleeper.User, league sleeper.League) []Team {
	byID := make(map[string]sleeper.User, len(users))
	for _, u := range users {
		byID[u.ID] = u
	}
	teams := make([]Team, 0, len(rosters))
	for _, r := range rosters {
		owner := byID[r.OwnerID]
		t := Team{
			RosterID: r.RosterID, Owner: owner.DisplayName, Name: owner.TeamName, Players: r.Players,
			Starters: starters(r.Starters), Reserve: r.Reserve, Taxi: r.Taxi, Wins: r.Wins, Losses: r.Losses, Ties: r.Ties,
			PointsFor: round2(r.PointsFor), Streak: sleeperStreak(r.Streak), WaiverOrder: r.WaiverPosition,
			Avatar: sleeperAvatar(owner.Avatar), Division: r.Division,
		}
		against := round2(r.PointsAgainst)
		t.PointsAgainst = &against
		if league.WaiverType == sleeper.WaiverBudget && league.WaiverBudget > 0 {
			left := max(league.WaiverBudget-r.BudgetUsed, 0)
			t.BudgetLeft = &left
		}
		if r.OwnerID != "" {
			t.OwnerIDs = append(t.OwnerIDs, r.OwnerID)
		}
		t.OwnerIDs = append(t.OwnerIDs, r.CoOwners...)
		if t.Name == "" {
			t.Name = t.Owner
		}
		teams = append(teams, t)
	}
	return teams
}

func sleeperMoves(txs []sleeper.Transaction) []Move {
	var out []Move
	for _, t := range txs {
		var kind string
		switch t.Type {
		case "free_agent":
			kind = MoveAdd
		case "waiver":
			kind = MoveWaiver
		case "trade":
			kind = MoveTrade
		default:
			continue
		}
		if t.Status != "complete" {
			continue
		}
		out = append(out, Move{Kind: kind, RosterIDs: t.RosterIDs, Adds: t.Adds, Drops: t.Drops, At: time.UnixMilli(t.Created).UTC(), Bid: t.Bid})
	}
	return out
}

// SeatByUsername is the roster the username runs or co-runs.
func (s *Sleeper) SeatByUsername(ctx context.Context, snap Snapshot, username string) (int, error) {
	userID, err := s.API.UserID(ctx, strings.TrimSpace(username))
	if errors.Is(err, sleeper.ErrNotFound) {
		return 0, ErrNoSeat
	}
	if err != nil {
		return 0, sleeperErr("user", err)
	}
	for _, t := range snap.Teams {
		for _, owner := range t.OwnerIDs {
			if owner == userID {
				return t.RosterID, nil
			}
		}
	}
	return 0, ErrNoSeat
}

// Players is Sleeper's directory; the season does not change it.
func (s *Sleeper) Players(ctx context.Context, _ int) ([]HostPlayer, error) {
	ps, err := s.API.Players(ctx)
	if err != nil {
		return nil, sleeperErr("players", err)
	}
	out := make([]HostPlayer, 0, len(ps))
	for _, p := range ps {
		out = append(out, HostPlayer{ID: p.ID, Name: p.Name, Position: p.Position, Team: cleanTeam(p.Team), ESPNID: p.ESPNID})
	}
	return out, nil
}

// preseason says the site's season has not reached week 1: the NFL
// state may count preseason weeks, which are no league's week.
func (s *Sleeper) preseason(ctx context.Context) bool {
	return s.Season != nil && s.Season.Phase(ctx).Phase == season.SitePreseason
}

// draftTime is the start time of a league's draft not yet done, from the
// draft itself; nil for a drafted league, a draft with no time set, or a
// draft read that failed (said in the log: the time is a fact the league
// reads without).
func (s *Sleeper) draftTime(ctx context.Context, league sleeper.League) *time.Time {
	if league.DraftID == "" || (league.Status != sleeper.LeaguePreDraft && league.Status != sleeper.LeagueDrafting) {
		return nil
	}
	d, err := s.API.Draft(ctx, league.DraftID)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("leaguesync: sleeper draft time", "league", league.ID, "draft", league.DraftID, "err", err)
		}
		return nil
	}
	return d.StartTime
}
