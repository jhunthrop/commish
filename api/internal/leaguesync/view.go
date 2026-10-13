package leaguesync

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// unlistedName stands in for a player the host's directory does not
// list yet (a signing since its last read).
const unlistedName = "A player not yet listed"

// view is the league as the link's drafter sees it.
func (s *Service) view(ctx context.Context, link Link, read Read) (apitypes.LeagueSync, error) {
	snap := read.Snapshot
	if snap.Ref.Host == HostFFPC {
		snap = ownLineupOnly(snap, link.RosterID)
	}
	saved, err := s.savedSettings(ctx, link)
	if err != nil {
		return apitypes.LeagueSync{}, err
	}
	board, err := s.Boards.For(ctx, ValuationSettings(snap, saved))
	if err != nil {
		return apitypes.LeagueSync{}, fmt.Errorf("leaguesync: board: %w", err)
	}
	ids := namedPlayers(snap)
	dir := snap.Players
	if dir == nil {
		if dir, err = s.Players.For(ctx, snap.Ref.Host, directorySeason(snap, s.Now()), ids); err != nil {
			return apitypes.LeagueSync{}, fmt.Errorf("leaguesync: directory: %w", err)
		}
	}
	placed := Place(board.Raw, dir, ids)
	p := players{dir: dir, placed: placed}
	out := apitypes.LeagueSync{
		Id: link.ID, Host: apitypes.LeagueHost(snap.Ref.Host), HostLeagueId: snap.Ref.LeagueID, Season: snap.Season,
		Name: snap.Name, Status: snap.Status, Week: snap.Week, Me: link.RosterID, SettingsLeagueId: link.LeagueID,
		ScoringDropped: nonNil(snap.Scoring.Dropped), ScoringDefaulted: nonNil(snap.Scoring.Defaulted),
		ScoringLike: NearestPreset(snap.Scoring.Rules), Teams: standings(snap.Teams), Moves: p.moves(snap.Moves),
		Rostered: rosteredIDs(rosteredOnBoard(snap, placed)), BoardFormat: boardFormat(snap), Byes: byes(board.Raw.Players),
		Placement: placement(snap, placed), ReadAt: snap.ReadAt, HostStaleSeconds: int(math.Round(read.Stale.Seconds())),
		Roster: []apitypes.RosterSpot{},
	}
	if saved == nil {
		out.SettingsLeagueId = nil
		out.SettingsNote = settingsNote(snap)
	}
	if team, ok := snap.TeamByRoster(link.RosterID); ok {
		out.Roster = p.roster(team)
	}
	out.Matchup = p.matchup(snap, link.RosterID)
	return out, nil
}

// directorySeason is the season whose directory names the league's
// players: the league's own, or this year's when the host does not say.
func directorySeason(snap Snapshot, now time.Time) int {
	if snap.Season > 0 {
		return snap.Season
	}
	return now.Year()
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func settingsNote(snap Snapshot) *string {
	_, reason := SettingsFor(snap)
	if reason == "" {
		reason = "Attach the league again to save it for mock drafts."
	}
	return &reason
}

// namedPlayers is every player the snapshot names: on a roster, in the
// week's matchup, or in a move.
func namedPlayers(snap Snapshot) []string {
	seen := map[string]bool{}
	var out []string
	add := func(ids ...string) {
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	for _, t := range snap.Teams {
		add(t.Players...)
		add(t.Reserve...)
		add(t.Taxi...)
	}
	for _, side := range snap.Matchups {
		add(side.Starters...)
	}
	for _, m := range snap.Moves {
		for id := range m.Adds {
			add(id)
		}
		for id := range m.Drops {
			add(id)
		}
	}
	return out
}

// rosteredOnBoard is the board id of every rostered player we placed.
func rosteredOnBoard(snap Snapshot, placed map[string]Placement) map[string]bool {
	out := map[string]bool{}
	for _, t := range snap.Teams {
		for _, list := range [][]string{t.Players, t.Reserve, t.Taxi} {
			for _, id := range list {
				if pl, ok := placed[id]; ok {
					out[pl.BoardID] = true
				}
			}
		}
	}
	return out
}

// placement counts how every rostered player was placed on our board.
func placement(snap Snapshot, placed map[string]Placement) apitypes.Placement {
	var out apitypes.Placement
	seen := map[string]bool{}
	for _, t := range snap.Teams {
		for _, list := range [][]string{t.Players, t.Reserve, t.Taxi} {
			for _, id := range list {
				if seen[id] {
					continue
				}
				seen[id] = true
				switch placed[id].How {
				case PlacedByESPN:
					out.ByEspnId++
				case PlacedByDefense:
					out.ByDefense++
				case PlacedByName:
					out.ByName++
				default:
					out.Unplaced++
				}
			}
		}
	}
	return out
}

// standings is every team, most wins first, then fewest losses, then
// points for.
func standings(teams []Team) []apitypes.LeagueTeam {
	sorted := append([]Team(nil), teams...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.Wins != b.Wins {
			return a.Wins > b.Wins
		}
		if a.Losses != b.Losses {
			return a.Losses < b.Losses
		}
		return a.PointsFor > b.PointsFor
	})
	out := make([]apitypes.LeagueTeam, 0, len(sorted))
	for _, t := range sorted {
		out = append(out, apitypes.LeagueTeam{
			RosterId: t.RosterID, Name: t.Name, Owner: t.Owner, Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: t.PointsFor,
		})
	}
	return out
}

// rosteredIDs is the rostered board ids, sorted.
func rosteredIDs(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// boardFormat is the run's board the league reads on: superflex for a
// league that starts one, otherwise its nearest scoring (TE premium has
// no board of its own and reads on PPR's).
func boardFormat(snap Snapshot) apitypes.BoardFormat {
	if snap.Shape.SuperFlex > 0 {
		return apitypes.BoardFormatSuperflex
	}
	switch NearestPreset(snap.Scoring.Rules) {
	case apitypes.ScoringPresetHalfPpr:
		return apitypes.BoardFormatHalfPpr
	case apitypes.ScoringPresetStandard:
		return apitypes.BoardFormatStandard
	}
	return apitypes.BoardFormatPpr
}

// byes is each team's bye week, from our board's schedule.
func byes(players []boards.Player) map[string]int {
	out := map[string]int{}
	for _, p := range players {
		if p.Bye > 0 && p.Team != "" {
			out[p.Team] = p.Bye
		}
	}
	return out
}
