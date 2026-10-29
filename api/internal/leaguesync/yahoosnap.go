package leaguesync

import (
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Yahoo's roster slots that hold no starter.
const (
	yahooBench   = "BN"
	yahooReserve = "IR"
	yahooFlex    = "W/R/T"
	yahooSuper   = "Q/W/R/T"
)

// yahooSnapshot is a Yahoo league's read as the snapshot every host
// fills: every team with its record and roster by slot, the week's games
// with each side's starters, the managers' moves, and the scoring
// through the one import map. ids is Yahoo's player id to our board's.
func yahooSnapshot(l yahoo.League, ids map[string]string, now time.Time) Snapshot {
	snap := Snapshot{
		Ref:  Ref{Host: HostYahoo, LeagueID: l.LeagueID, Season: l.Season},
		Name: scoring.HostText(l.Name), Status: yahooStatus(l), Season: l.Season, Week: l.Scoreboard.Week,
		Players: map[string]HostPlayer{}, ReadAt: now,
		Calendar: Calendar{DraftAt: l.DraftAt, PlayoffStartWeek: l.PlayoffStartWeek},
	}
	if snap.Week == 0 {
		snap.Week = l.CurrentWeek
	}
	byID := map[int]Team{}
	for _, t := range l.Teams {
		team := Team{RosterID: t.ID, Name: scoring.HostText(t.Name), Owner: scoring.HostText(t.Owner),
			Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: round2(t.PointsFor), Division: t.Division}
		for _, p := range t.Players {
			id := snap.addYahooPlayer(p, ids)
			team.Players = append(team.Players, id)
			switch p.Slot {
			case yahooBench:
			case yahooReserve:
				team.Reserve = append(team.Reserve, id)
			default:
				team.Starters = append(team.Starters, id)
			}
		}
		byID[t.ID] = team
		snap.Teams = append(snap.Teams, team)
	}
	sort.Slice(snap.Teams, func(i, j int) bool { return snap.Teams[i].RosterID < snap.Teams[j].RosterID })
	for i, g := range l.Scoreboard.Games {
		for k, id := range g.TeamIDs {
			snap.Matchups = append(snap.Matchups, Side{
				RosterID: id, Game: i + 1, Points: round2(g.Points[k]), Starters: byID[id].Starters, PlayerPoints: map[string]float64{},
			})
		}
	}
	snap.Moves = yahooMoves(l.Moves, &snap, ids)
	snap.PoolUnknown = l.WaiversErr != nil
	for _, w := range l.Waivers {
		snap.Pool = append(snap.Pool, PoolPlayer{PlayerID: snap.addYahooPlayer(w.Player, ids), Status: PoolWaivers, Until: w.Until})
	}
	im := l.Settings.Scoring()
	snap.Scoring = Scoring{Rules: im.Rules, Dropped: scoring.DroppedWords(im.Dropped), DroppedRules: im.Dropped, Defaulted: im.Defaulted}
	snap.Shape = yahooShape(l.Settings, len(snap.Teams))
	snap.Terms = Terms{PlayoffTeams: l.PlayoffTeams, PlayoffFirst: l.PlayoffStartWeek, StartWeek: l.StartWeek,
		DivisionsRead: true, Divisions: divisionsOf(snap.Teams)}
	return snap
}

func yahooStatus(l yahoo.League) string {
	switch {
	case l.Finished:
		return StatusComplete
	case l.DraftStatus == "predraft":
		return StatusPreDraft
	case l.DraftStatus == "draft":
		return StatusDrafting
	}
	return StatusInSeason
}

// addYahooPlayer keeps a player in the snapshot's directory, with our
// board's id for him when the id map names him, and answers his id.
func (s *Snapshot) addYahooPlayer(p yahoo.Player, ids map[string]string) string {
	hp, ok := s.Players[p.ID]
	if !ok {
		hp = HostPlayer{ID: p.ID, Name: scoring.HostText(p.Name), Position: p.Position, Team: cleanTeam(p.Team), ESPNID: ids[p.ID]}
	}
	hp.InjuredReserve = hp.InjuredReserve || p.Injured
	s.Players[p.ID] = hp
	return p.ID
}

// yahooMoves is the managers' moves, newest first, at most maxMovesShown.
func yahooMoves(moves []yahoo.Move, snap *Snapshot, ids map[string]string) []Move {
	out := make([]Move, 0, len(moves))
	for _, m := range moves {
		for _, p := range m.Players {
			snap.addYahooPlayer(p, ids)
		}
		teams := map[int]bool{}
		for _, t := range m.Adds {
			teams[t] = true
		}
		for _, t := range m.Drops {
			teams[t] = true
		}
		roster := make([]int, 0, len(teams))
		for t := range teams {
			roster = append(roster, t)
		}
		sort.Ints(roster)
		out = append(out, Move{Kind: m.Kind, RosterIDs: roster, Adds: m.Adds, Drops: m.Drops, At: m.At})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out[:min(len(out), maxMovesShown)]
}

// yahooShape counts the league's lineup by our slot names. A slot outside
// the rooms' roster (a receiver-only flex, a defender) is named in
// Unfollowed rather than guessed at.
func yahooShape(s yahoo.Settings, teams int) Shape {
	sh := Shape{Teams: teams}
	unfollowed := map[string]bool{}
	for _, slot := range s.Slots {
		n := slot.Count
		switch slot.Position {
		case posQB:
			sh.QB += n
		case posRB:
			sh.RB += n
		case posWR:
			sh.WR += n
		case posTE:
			sh.TE += n
		case posK:
			sh.K += n
		case posDEF:
			sh.DEF += n
		case yahooFlex:
			sh.Flex += n
		case yahooSuper:
			sh.SuperFlex += n
		case yahooBench:
			sh.Bench += n
		case yahooReserve:
			// Yahoo's IR slot takes the injured reserve lists, never a week's out (Lane 118, B79).
			sh.IR += n
		default:
			if w := scoring.HostText(slot.Position); w != "" && n > 0 {
				unfollowed[w] = true
			}
		}
	}
	sh.Unfollowed = sortedKeys(unfollowed)
	return sh
}

// divisionsOf is how many divisions the teams name (Yahoo's division_id on
// each team, Lane 298 fix round 1): 0 when none does.
func divisionsOf(teams []Team) int {
	seen := map[int]bool{}
	for _, t := range teams {
		if t.Division > 0 {
			seen[t.Division] = true
		}
	}
	return len(seen)
}
