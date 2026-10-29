package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/mfl"
)

// MFLAPI is the part of *mfl.Client a league read needs; the replay
// fixture implements it too.
type MFLAPI interface {
	League(ctx context.Context, season int, id string) (mfl.League, error)
	Rosters(ctx context.Context, season int, id string) ([]mfl.Roster, error)
	Rules(ctx context.Context, season int, id string) ([]mfl.Rule, error)
	Standings(ctx context.Context, season int, id string) ([]mfl.Standing, error)
	LiveScoring(ctx context.Context, season int, id string, week int) ([]mfl.Matchup, error)
	Transactions(ctx context.Context, season int, id string, week int) ([]mfl.Transaction, error)
	SeasonStatus(ctx context.Context, season int) (mfl.Status, error)
	Players(ctx context.Context, season int) ([]mfl.Player, error)
	DraftResults(ctx context.Context, season int, id string) (mfl.DraftResults, error)
	Schedule(ctx context.Context, season int, id string) ([]mfl.ScheduleGame, error)
}

// mflDraftTTL is how long a league's draft results answer is kept while
// its draft is not done: one more export a league each read would double
// the reads a league that never drafts on the host (a dynasty league)
// costs. A done draft is kept for good.
const mflDraftTTL = time.Hour

// MFL is the MyFantasyLeague host.
type MFL struct {
	API MFLAPI
	Now func() time.Time
	// Log is where a draft results read that failed is said, nil for none.
	Log *slog.Logger

	mu       sync.Mutex
	status   map[int]mfl.Status
	statusAt map[int]time.Time
	drafts   map[string]mflDraft
}

// mflDraft is a league's draft as its results last said, and when.
type mflDraft struct {
	status   string
	unstated bool
	at       time.Time
}

// Key is the host's contract name.
func (m *MFL) Key() string { return HostMFL }

// Owns reports a myfantasyleague.com address.
func (m *MFL) Owns(pasted string) bool { return mfl.IsLink(pasted) }

// Parse reads the season and league id from a league link.
func (m *MFL) Parse(pasted string) (Ref, error) {
	r, err := mfl.ParseLeagueLink(pasted)
	if err != nil {
		return Ref{}, ErrNotALink
	}
	return Ref{Host: HostMFL, LeagueID: r.ID, Season: r.Season}, nil
}

func mflErr(what string, err error) error {
	switch {
	case errors.Is(err, mfl.ErrBusy):
		return fmt.Errorf("%w: %s: %v", ErrBusy, what, err)
	case errors.Is(err, mfl.ErrPrivate):
		return fmt.Errorf("%w: %s: %v", ErrPrivate, what, err)
	case errors.Is(err, mfl.ErrNotFound):
		return fmt.Errorf("%w: %s: %v", ErrNotFound, what, err)
	default:
		return fmt.Errorf("%w: %s: %v", ErrUnavailable, what, err)
	}
}

func (m *MFL) seasonStatus(ctx context.Context, season int) (mfl.Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status == nil {
		m.status, m.statusAt = map[int]mfl.Status{}, map[int]time.Time{}
	}
	now := m.Now()
	if at, ok := m.statusAt[season]; ok && now.Sub(at) < stateTTL {
		return m.status[season], nil
	}
	st, err := m.API.SeasonStatus(ctx, season)
	if err != nil {
		return mfl.Status{}, mflErr("status", err)
	}
	m.status[season], m.statusAt[season] = st, now
	return st, nil
}

// Read is one whole read: the league's setup, rosters, rules,
// standings, the week's live scoring and the last two weeks' moves. A
// league whose setup answers but whose rosters do not is private: the
// host shows a private league's setup to anyone.
func (m *MFL) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	league, err := m.API.League(ctx, ref.Season, ref.LeagueID)
	if err != nil {
		return Snapshot{}, mflErr("league", err)
	}
	rosters, err := m.API.Rosters(ctx, ref.Season, ref.LeagueID)
	if err != nil {
		return Snapshot{}, privateAfterSetup("rosters", err)
	}
	rules, err := m.API.Rules(ctx, ref.Season, ref.LeagueID)
	if err != nil {
		return Snapshot{}, privateAfterSetup("rules", err)
	}
	standings, err := m.API.Standings(ctx, ref.Season, ref.LeagueID)
	if err != nil {
		return Snapshot{}, privateAfterSetup("standings", err)
	}
	status, err := m.seasonStatus(ctx, ref.Season)
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{
		Ref: ref, Name: league.Name, Season: ref.Season, Teams: mflTeams(league, rosters, standings),
		Scoring: mflScoring(rules), Shape: mflShape(league), ReadAt: m.Now(),
	}
	if status.Season == ref.Season && status.CurrentWeek >= 1 {
		snap.Week = status.CurrentWeek
	}
	// MyFantasyLeague states nothing on when its waivers close.
	snap.Calendar.PlayoffStartWeek, snap.Calendar.WaiversUnstated = mflPlayoffStart(league), true
	if snap.Calendar.PlayoffStartWeek == 0 {
		snap.Calendar.RegularSeasonLast = league.LastRegularSeasonWeek
	}
	snap.Status, snap.Calendar.DraftUnstated = m.draftStatus(ctx, ref, snap.Week)
	if snap.Calendar.DraftUnstated {
		snap.Calendar.DraftReadBy = ReadByWeek
	}
	if league.EndWeek > 0 && status.Season == ref.Season && status.CompletedWeek >= league.EndWeek {
		snap.Status = StatusComplete
	}
	if snap.Week == 0 {
		return snap, nil
	}
	live, err := m.API.LiveScoring(ctx, ref.Season, ref.LeagueID, snap.Week)
	if err != nil {
		return Snapshot{}, privateAfterSetup("live scoring", err)
	}
	var txs []mfl.Transaction
	// This week's moves and last week's, as Sleeper's legs give them.
	for _, week := range []int{snap.Week, snap.Week - 1} {
		if week < 1 {
			continue
		}
		moves, err := m.API.Transactions(ctx, ref.Season, ref.LeagueID, week)
		if err != nil {
			return Snapshot{}, privateAfterSetup("transactions", err)
		}
		txs = append(txs, moves...)
	}
	snap.Matchups, snap.Moves = mflSides(live), mflMoves(txs)
	snap.Teams = withStarters(snap.Teams, snap.Matchups)
	return snap, nil
}

// mflPlayoffStart is the week after the league's last regular-season
// week, 0 when it states none or its regular season is its whole season.
func mflPlayoffStart(l mfl.League) int {
	if l.LastRegularSeasonWeek < 1 || (l.EndWeek > 0 && l.LastRegularSeasonWeek >= l.EndWeek) {
		return 0
	}
	return l.LastRegularSeasonWeek + 1
}

// draftStatus is the league's state from its draft results: every pick
// made is past the draft, some is a draft under way, none is before it.
// Results with no picks, or none answered (logged), leave the draft
// unstated: a week under way reads as in season, else before the draft.
func (m *MFL) draftStatus(ctx context.Context, ref Ref, week int) (string, bool) {
	key, now := ref.Key(), m.Now()
	m.mu.Lock()
	kept, ok := m.drafts[key]
	m.mu.Unlock()
	done := kept.status == StatusInSeason && !kept.unstated
	if ok && (done || now.Sub(kept.at) < mflDraftTTL) {
		return m.byWeek(kept, week)
	}
	d, err := m.API.DraftResults(ctx, ref.Season, ref.LeagueID)
	got := mflDraft{unstated: true, at: now}
	switch {
	case err != nil:
		if m.Log != nil {
			m.Log.Warn("leaguesync: mfl draft results", "league", key, "err", err)
		}
	case d.Picks > 0 && d.Made == d.Picks:
		got = mflDraft{status: StatusInSeason, at: now}
	case d.Made > 0:
		got = mflDraft{status: StatusDrafting, at: now}
	case d.Picks > 0:
		got = mflDraft{status: StatusPreDraft, at: now}
	}
	m.mu.Lock()
	m.drafts = keep(m.drafts, key, got)
	m.mu.Unlock()
	return m.byWeek(got, week)
}

// byWeek is a kept draft answer as a status: an unstated draft goes by
// the host's week.
func (m *MFL) byWeek(d mflDraft, week int) (string, bool) {
	switch {
	case !d.unstated:
		return d.status, false
	case week >= 1:
		return StatusInSeason, true
	}
	return StatusPreDraft, true
}

// privateAfterSetup reads a refusal after the setup answered as the
// league being private.
func privateAfterSetup(what string, err error) error {
	if errors.Is(err, mfl.ErrNotFound) {
		return fmt.Errorf("%w: %s: %v", ErrPrivate, what, err)
	}
	return mflErr(what, err)
}

func mflTeams(l mfl.League, rosters []mfl.Roster, standings []mfl.Standing) []Team {
	byRoster := map[int]mfl.Roster{}
	for _, r := range rosters {
		byRoster[r.Franchise] = r
	}
	byStanding := map[int]mfl.Standing{}
	for _, s := range standings {
		byStanding[s.Franchise] = s
	}
	teams := make([]Team, 0, len(l.Franchises))
	for _, f := range l.Franchises {
		r, st := byRoster[f.ID], byStanding[f.ID]
		teams = append(teams, Team{
			RosterID: f.ID, Name: f.Name, Players: r.Players, Reserve: r.Reserve, Taxi: r.Taxi,
			Wins: st.Wins, Losses: st.Losses, Ties: st.Ties, PointsFor: round2(st.PointsFor),
		})
	}
	return teams
}

// withStarters sets each team's lineup from the week's live scoring:
// the host's rosters export carries no lineup, its live scoring does.
func withStarters(teams []Team, sides []Side) []Team {
	starters := map[int][]string{}
	for _, s := range sides {
		if _, ok := starters[s.RosterID]; !ok || s.Game != 0 {
			starters[s.RosterID] = s.Starters
		}
	}
	out := make([]Team, len(teams))
	for i, t := range teams {
		out[i] = t
		if st, ok := starters[t.RosterID]; ok {
			out[i].Starters = st
		}
	}
	return out
}

// mflSides numbers each game so its two sides pair, as Sleeper's
// matchup id does.
func mflSides(matchups []mfl.Matchup) []Side {
	var out []Side
	for i, m := range matchups {
		for _, s := range m.Sides {
			game := i + 1
			if len(m.Sides) < 2 {
				game = 0
			}
			out = append(out, Side{RosterID: s.Franchise, Game: game, Points: round2(s.Score), Starters: s.Starters, PlayerPoints: s.Points})
		}
	}
	return out
}

func mflMoves(txs []mfl.Transaction) []Move {
	out := make([]Move, 0, len(txs))
	for _, t := range txs {
		kind := MoveAdd
		switch t.Type {
		case mfl.MoveWaiver, mfl.MoveBlindBid:
			kind = MoveWaiver
		case mfl.MoveTrade:
			kind = MoveTrade
		}
		out = append(out, Move{Kind: kind, RosterIDs: t.Franchises, Adds: t.Adds, Drops: t.Drops, At: time.Unix(t.At, 0).UTC()})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out
}

// SeatByUsername is refused: the host shows a member's name only to the
// league's own members, so the drafter picks their team instead.
func (m *MFL) SeatByUsername(context.Context, Snapshot, string) (int, error) {
	return 0, ErrSeatByName
}

// Players is the host's directory for the season.
func (m *MFL) Players(ctx context.Context, season int) ([]HostPlayer, error) {
	ps, err := m.API.Players(ctx, season)
	if err != nil {
		return nil, mflErr("players", err)
	}
	out := make([]HostPlayer, 0, len(ps))
	for _, p := range ps {
		out = append(out, HostPlayer{ID: p.ID, Name: p.Name, Position: p.Position, Team: cleanTeam(p.Team), ESPNID: p.ESPNID})
	}
	return out, nil
}
