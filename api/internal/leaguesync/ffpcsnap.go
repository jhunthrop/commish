package leaguesync

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// ffpcSnapshot is an FFPC league's pages as the snapshot every host
// fills: the banner's league, the standings with owners, every roster,
// the member's starters from their lineup page, this week's games from
// the schedule, the moves panel, and the rules' scoring through the
// 21-key map.
//
// week is the league's current week, chosen by the caller (FFPC.week).
func ffpcSnapshot(l ffpc.League, now time.Time, week int) Snapshot {
	snap := Snapshot{
		Ref: Ref{Host: HostFFPC, LeagueID: l.Banner.LeagueID, Season: l.Banner.Season}, Name: cleanHostText(l.Banner.LeagueName),
		Status: "in_season", Season: l.Banner.Season, Players: map[string]HostPlayer{}, ReadAt: now,
	}
	teams := map[int]*Team{}
	team := func(id int) *Team {
		if t, ok := teams[id]; ok {
			return t
		}
		t := &Team{RosterID: id}
		teams[id] = t
		return t
	}
	owners := map[string]string{}
	for _, o := range l.Owners {
		owners[o.Team] = o.Owner
	}
	for _, s := range l.Standings {
		t := team(s.TeamID)
		t.Name, t.Owner = s.Name, owners[s.Name]
		t.Wins, t.Losses, t.Ties, t.PointsFor = s.Wins, s.Losses, s.Ties, round2(s.PointsFor)
	}
	for _, r := range l.Rosters {
		t := team(r.TeamID)
		if t.Name == "" {
			t.Name, t.Owner = r.Name, owners[r.Name]
		}
		for _, p := range r.Players {
			t.Players = append(t.Players, snap.addPlayer(p))
		}
		t.Reserve = snap.addPlayers(t.Reserve, r.Reserve)
		t.Taxi = snap.addPlayers(t.Taxi, r.Taxi)
	}
	if l.Lineup != nil && l.Banner.TeamID > 0 {
		t := team(l.Banner.TeamID)
		var all []string
		for _, p := range l.Lineup.Starters {
			id := snap.addPlayer(p)
			t.Starters, all = append(t.Starters, id), append(all, id)
		}
		for _, p := range l.Lineup.Bench {
			all = append(all, snap.addPlayer(p))
		}
		if len(t.Players) == 0 {
			t.Players = all
		}
		t.Reserve = snap.addPlayers(t.Reserve, l.Lineup.Reserve)
		t.Taxi = snap.addPlayers(t.Taxi, l.Lineup.Taxi)
	}
	if l.Banner.TeamID > 0 && team(l.Banner.TeamID).Name == "" {
		team(l.Banner.TeamID).Name = cleanHostText(l.Banner.TeamName)
	}
	for _, t := range teams {
		snap.Teams = append(snap.Teams, *t)
	}
	sort.Slice(snap.Teams, func(i, j int) bool { return snap.Teams[i].RosterID < snap.Teams[j].RosterID })
	snap.Week = week
	snap.Matchups, snap.AllPlay = ffpcGames(l.Schedule, snap.Week)
	if l.Banner.TeamID > 0 {
		snap.Matchups = withMemberSide(snap.Matchups, snap.AllPlay, *team(l.Banner.TeamID), memberScore(l, week))
	}
	snap.Moves = ffpcMoves(l.Moves, &snap)
	if l.Rules != nil {
		snap.Scoring = ffpcScoring(*l.Rules)
		snap.Shape = ffpcShape(*l.Rules, len(snap.Teams))
	}
	return snap
}

// addPlayer keeps a player in the snapshot's directory and answers his
// id: FFPC's own, or for a player a page names without one, an id made
// from his name, position and team, which only the name step places.
func (s *Snapshot) addPlayer(p ffpc.Player) string {
	id := p.ID
	if id == "" {
		sum := sha256.Sum256([]byte(p.Name + "|" + p.Position + "|" + p.Team))
		id = "n" + hex.EncodeToString(sum[:])[:15]
	}
	if _, ok := s.Players[id]; !ok {
		s.Players[id] = HostPlayer{ID: id, Name: cleanHostText(p.Name), Position: p.Position, Team: cleanTeam(p.Team)}
	}
	return id
}

// addPlayers keeps each player and adds his id to ids once.
func (s *Snapshot) addPlayers(ids []string, players []ffpc.Player) []string {
	for _, p := range players {
		id := s.addPlayer(p)
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids
}

// ffpcWeek is the league's week: the lineup page's, else the schedule's
// week holding today.
func ffpcWeek(l ffpc.League, now time.Time) int {
	if l.Lineup != nil && l.Lineup.Week > 0 {
		return l.Lineup.Week
	}
	return ffpc.WeekOf(l.Schedule, now)
}

// ffpcGames is the week's games as sides, and whether the schedule sets
// the week as all-play (a Big Gorilla week every team plays every other,
// with no games listed).
func ffpcGames(weeks []ffpc.Week, number int) ([]Side, bool) {
	var out []Side
	allPlay := false
	for _, w := range weeks {
		if w.Number != number {
			continue
		}
		allPlay = w.AllPlay
		for i, g := range w.Games {
			out = append(out,
				Side{RosterID: g.Away, Game: i + 1, Points: round2(g.AwayPoints), PlayerPoints: map[string]float64{}},
				Side{RosterID: g.Home, Game: i + 1, Points: round2(g.HomePoints), PlayerPoints: map[string]float64{}})
		}
	}
	return out, allPlay
}

// withMemberSide gives the member's side their starters from their
// lineup page, and in an all-play week, when the schedule lists no game,
// a side of their own scored from the scoring page: score, when nil, was
// not read, and the side says so instead of reading as 0.
func withMemberSide(sides []Side, allPlay bool, member Team, score *float64) []Side {
	found := false
	for i := range sides {
		if sides[i].RosterID == member.RosterID {
			sides[i].Starters, found = member.Starters, true
		}
	}
	if !found && allPlay {
		side := Side{RosterID: member.RosterID, Starters: member.Starters, PlayerPoints: map[string]float64{}, PointsUnread: score == nil}
		if score != nil {
			side.Points = round2(*score)
		}
		sides = append(sides, side)
	}
	return sides
}

// memberScore is the member's total for the week from the scoring page,
// nil when the page was not read, is set to another week, or carries
// another team's card.
func memberScore(l ffpc.League, week int) *float64 {
	b := l.Scoreboard
	if b == nil || b.Week != week || !sameTeam(b.Team, l.Banner.TeamName) {
		return nil
	}
	points := b.Points
	return &points
}

// sameTeam compares two of FFPC's renderings of one team's name.
func sameTeam(a, b string) bool {
	return a != "" && strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

// ffpcMoves is the moves panel's moves, newest first.
func ffpcMoves(moves []ffpc.Move, snap *Snapshot) []Move {
	out := make([]Move, 0, len(moves))
	for _, m := range moves {
		kind := MoveAdd
		if m.Trade {
			kind = MoveTrade
		}
		mv := Move{Kind: kind, RosterIDs: []int{m.TeamID}, Adds: map[string]int{}, Drops: map[string]int{}, At: m.At.UTC()}
		for _, p := range m.Adds {
			mv.Adds[snap.addPlayer(p)] = m.TeamID
		}
		for _, p := range m.Drops {
			mv.Drops[snap.addPlayer(p)] = m.TeamID
		}
		out = append(out, mv)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out[:min(len(out), maxMovesShown)]
}

// ffpcScoring maps the rules' scoring (Sleeper key names) through the
// 21-key map and names, in FFPC's words, every line no key carries.
func ffpcScoring(r ffpc.Rules) Scoring {
	sc := sleeperScoring(r.Scoring)
	for _, line := range r.Unread {
		if w := cleanHostText(line); w != "" {
			sc.Dropped = append(sc.Dropped, w)
		}
	}
	sort.Strings(sc.Dropped)
	return sc
}

// ownLineupOnly is the snapshot with every team's starters dropped but the
// viewer's own: an FFPC league is read as one member, whose lineup page is
// theirs to see, never their league-mates'.
func ownLineupOnly(snap Snapshot, me int) Snapshot {
	out := snap
	out.Teams = make([]Team, len(snap.Teams))
	for i, t := range snap.Teams {
		if t.RosterID != me {
			t.Starters = nil
		}
		out.Teams[i] = t
	}
	out.Matchups = make([]Side, len(snap.Matchups))
	for i, s := range snap.Matchups {
		if s.RosterID != me {
			s.Starters = nil
		}
		out.Matchups[i] = s
	}
	return out
}

// ffpcShape is the rules' lineup, the bench made up to the roster size.
func ffpcShape(r ffpc.Rules, teams int) Shape {
	l := r.Lineup
	if r.Teams > 0 {
		teams = r.Teams
	}
	s := Shape{Teams: teams, QB: l.QB, RB: l.RB, WR: l.WR, TE: l.TE, K: l.K, DEF: l.DEF, Flex: l.Flex, SuperFlex: l.SuperFlex}
	if r.RosterSpots > l.Starters() {
		s.Bench = r.RosterSpots - l.Starters()
	}
	for _, o := range l.Other {
		s.Unfollowed = append(s.Unfollowed, cleanHostText(o))
	}
	if !r.HasLineup {
		s.Unfollowed = append(s.Unfollowed, fmt.Sprintf("a lineup %s does not state", "the rules page"))
	}
	return s
}
