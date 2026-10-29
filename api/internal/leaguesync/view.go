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

// prepared is a read made ready for a page: the snapshot as the link's
// drafter may see it, the saved league, the board valued for the league,
// and every named player placed on it.
type prepared struct {
	snap    Snapshot
	saved   *apitypes.LeagueSettings
	board   boards.Board
	ids     []string
	placed  map[string]Placement
	players players
}

// prepare is what the league page and the in-season tools both read.
func (s *Service) prepare(ctx context.Context, link Link, read Read) (prepared, error) {
	snap := read.Snapshot
	if snap.Ref.Host == HostFFPC {
		snap = ownLineupOnly(snap, link.RosterID)
	}
	saved, err := s.savedSettings(ctx, link, read)
	if err != nil {
		return prepared{}, err
	}
	board, err := s.Boards.For(ctx, ValuationSettings(snap, saved))
	if err != nil {
		return prepared{}, fmt.Errorf("leaguesync: board: %w", err)
	}
	ids := namedPlayers(snap)
	dir := snap.Players
	if dir == nil {
		if dir, err = s.Players.For(ctx, snap.Ref.Host, directorySeason(snap, s.Now()), ids); err != nil {
			return prepared{}, fmt.Errorf("leaguesync: directory: %w", err)
		}
	}
	placed := Place(board.Raw, dir, ids)
	return prepared{snap: snap, saved: saved, board: board, ids: ids, placed: placed, players: players{dir: dir, placed: placed}}, nil
}

// view is the league as the link's drafter sees it.
func (s *Service) view(ctx context.Context, link Link, read Read) (apitypes.LeagueSync, error) {
	pr, err := s.prepare(ctx, link, read)
	if err != nil {
		return apitypes.LeagueSync{}, err
	}
	snap, saved, board, placed, p := pr.snap, pr.saved, pr.board, pr.placed, pr.players
	scoringLike, format := LeagueScoring(saved, snap.Scoring.Rules, snap.Shape.SuperFlex > 0)
	held, twice := heldOnBoard(snap, placed)
	if twice > 0 {
		s.Log.Warn("leaguesync: players on two rosters in one read", "league", snap.Ref.Key(), "players", twice)
	}
	out := apitypes.LeagueSync{
		Id: link.ID, Host: apitypes.LeagueHost(snap.Ref.Host), HostLeagueId: snap.Ref.LeagueID, Season: snap.Season,
		Name: snap.Name, Status: snap.Status, Week: snap.Week, WeekAllPlay: snap.AllPlay, Me: link.RosterID, SettingsLeagueId: link.LeagueID,
		ScoringDropped: nonNil(snap.Scoring.Dropped), ScoringDefaulted: nonNil(snap.Scoring.Defaulted),
		ScoringLike: scoringLike, Teams: standings(snap.Teams), Moves: p.moves(snap.Moves),
		HeldBy: held, Rostered: rosteredIDs(held), BoardFormat: format, Byes: byes(board.Raw.Players),
		Placement: placement(snap, placed), ReadAt: snap.ReadAt, HostStaleSeconds: int(math.Round(read.Stale.Seconds())),
		HostFailed: read.Failed, HostSignedOut: read.SignedOut,
		Roster: []apitypes.RosterSpot{}, Terms: terms(snap), MovesRead: movesRead(snap.Ref.Host),
	}
	if saved == nil {
		out.SettingsLeagueId = nil
		out.SettingsNote = settingsNote(snap)
	}
	if team, ok := snap.TeamByRoster(link.RosterID); ok {
		out.Roster = p.roster(team)
	}
	out.Matchup = p.matchup(snap, link.RosterID)
	out.PointsVsMedian = pointsVsMedian(snap, link.RosterID)
	if chances, ok := s.chances.of(snap); ok {
		for i := range out.Teams {
			pct, has := chances.ByRoster[out.Teams[i].RosterId]
			if has {
				out.Teams[i].PlayoffChance = &pct
			}
		}
		out.PlayoffChanceBasis = &chances.Basis
	}
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

// heldOnBoard is the roster holding every rostered player we placed, by
// his board id, and how many the read names on two rosters (a host glitch
// or a trade read halfway): those keep the later team in the read's order.
func heldOnBoard(snap Snapshot, placed map[string]Placement) (map[string]int, int) {
	out := map[string]int{}
	twice := 0
	for _, t := range snap.Teams {
		for _, list := range [][]string{t.Players, t.Reserve, t.Taxi} {
			for _, id := range list {
				pl, ok := placed[id]
				if !ok {
					continue
				}
				if was, seen := out[pl.BoardID]; seen && was != t.RosterID {
					twice++
				}
				out[pl.BoardID] = t.RosterID
			}
		}
	}
	return out, twice
}

// rosteredIDs is held's board ids, sorted: the deprecated rostered field
// a web from before held_by reads during the deploy window. Removed after
// 2026-10-21 once the web that reads held_by has shipped.
func rosteredIDs(held map[string]int) []string {
	out := make([]string, 0, len(held))
	for id := range held {
		out = append(out, id)
	}
	sort.Strings(out)
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

// standingOf is the roster's record and place in the league, nil when
// the league has no read or the roster is not in it.
func standingOf(teams []Team, roster int) *apitypes.LeagueStanding {
	for i, t := range standings(teams) {
		if t.RosterId == roster {
			return &apitypes.LeagueStanding{Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, Place: i + 1, Teams: len(teams)}
		}
	}
	return nil
}

// Standings is every team, most wins first, then fewest losses, then
// points for: the league page's order.
func Standings(teams []Team) []Team {
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
	return sorted
}

// standings is every team on the wire, in Standings' order.
func standings(teams []Team) []apitypes.LeagueTeam {
	sorted := Standings(teams)
	out := make([]apitypes.LeagueTeam, 0, len(sorted))
	for _, t := range sorted {
		out = append(out, TeamOnWire(t))
	}
	return out
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
