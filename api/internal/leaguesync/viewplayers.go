package leaguesync

import (
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// players turns host ids into the wire's players: the host's own name,
// position and team, and the board id we placed him at.
type players struct {
	dir    map[string]HostPlayer
	placed map[string]Placement
}

func (p players) player(id string) apitypes.LeaguePlayer {
	hp, ok := p.dir[id]
	out := apitypes.LeaguePlayer{HostId: id, Name: unlistedName}
	if ok {
		out.Name, out.Position, out.Team = hp.Name, hp.Position, ourTeam(hp.Team)
		out.InjuredReserve = hp.InjuredReserve
	}
	if pl, ok := p.placed[id]; ok {
		board := pl.BoardID
		out.BoardId = &board
	}
	return out
}

// roster is the team's players: starters in lineup order, then the
// bench, then injured reserve and the taxi squad.
func (p players) roster(t Team) []apitypes.RosterSpot {
	out := make([]apitypes.RosterSpot, 0, len(t.Players)+len(t.Reserve)+len(t.Taxi))
	placed := map[string]bool{}
	add := func(id string, slot apitypes.RosterSpotSlot) {
		if placed[id] {
			return
		}
		placed[id] = true
		out = append(out, apitypes.RosterSpot{Player: p.player(id), Slot: slot})
	}
	set := func(ids []string) map[string]bool {
		m := make(map[string]bool, len(ids))
		for _, id := range ids {
			m[id] = true
		}
		return m
	}
	reserve, taxi := set(t.Reserve), set(t.Taxi)
	for _, id := range t.Starters {
		add(id, apitypes.RosterSpotSlotStarter)
	}
	for _, id := range t.Players {
		if !reserve[id] && !taxi[id] {
			add(id, apitypes.RosterSpotSlotBench)
		}
	}
	for _, id := range t.Reserve {
		add(id, apitypes.RosterSpotSlotReserve)
	}
	for _, id := range t.Taxi {
		add(id, apitypes.RosterSpotSlotTaxi)
	}
	return out
}

func (p players) side(s Side) apitypes.MatchupSide {
	out := apitypes.MatchupSide{RosterId: s.RosterID, Points: s.Points, PointsRead: !s.PointsUnread,
		Starters: make([]apitypes.MatchupStarter, 0, len(s.Starters))}
	for _, id := range s.Starters {
		out.Starters = append(out.Starters, apitypes.MatchupStarter{Player: p.player(id), Points: round2(s.PlayerPoints[id])})
	}
	return out
}

// matchup is the drafter's side of the week's game and the side they
// play, nil when the league has no game for them this week.
func (p players) matchup(snap Snapshot, roster int) *apitypes.LeagueMatchup {
	// A league that also plays the week's average lists a team twice:
	// the game against another team is the matchup.
	var mine *Side
	for i := range snap.Matchups {
		side := &snap.Matchups[i]
		if side.RosterID == roster && (mine == nil || (mine.Game == 0 && side.Game != 0)) {
			mine = side
		}
	}
	if mine == nil {
		return nil
	}
	out := &apitypes.LeagueMatchup{Week: snap.Week, Mine: p.side(*mine)}
	if mine.Game == 0 {
		return out
	}
	for _, s := range snap.Matchups {
		if s.Game == mine.Game && s.RosterID != roster {
			opp := p.side(s)
			out.Opponent = &opp
			break
		}
	}
	return out
}

func (p players) movePlayers(m map[string]int) []apitypes.MovePlayer {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]apitypes.MovePlayer, 0, len(ids))
	for _, id := range ids {
		out = append(out, apitypes.MovePlayer{Player: p.player(id), RosterId: m[id]})
	}
	return out
}

// moves is the newest moves, at most maxMovesShown.
func (p players) moves(moves []Move) []apitypes.LeagueMove {
	if len(moves) > maxMovesShown {
		moves = moves[:maxMovesShown]
	}
	out := make([]apitypes.LeagueMove, 0, len(moves))
	for _, m := range moves {
		ids := m.RosterIDs
		if ids == nil {
			ids = []int{}
		}
		out = append(out, apitypes.LeagueMove{
			Kind: apitypes.LeagueMoveKind(m.Kind), At: m.At, RosterIds: ids, Adds: p.movePlayers(m.Adds), Drops: p.movePlayers(m.Drops),
		})
	}
	return out
}
