package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/season"
)

// HostESPN is ESPN: a public league is read as the public reads it, a
// private one with the cookies of a connected member who follows it.
const HostESPN = espnhost.Host

// ESPNMember reads ESPN with a member's cookies. *espnhost.Member
// implements it.
type ESPNMember interface {
	Cookies(ctx context.Context, accountID uuid.UUID) (espn.Cookies, error)
	ReadLeague(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (espn.FullLeague, error)
}

// ESPNPublic reads a public league. *espn.Client implements it.
type ESPNPublic interface {
	Read(ctx context.Context, id string, season int, cookies *espn.Cookies) (espn.FullLeague, error)
}

// ESPN is the ESPN host: a public league read with no cookies, for
// anyone; a league attached as a member read with that account's own
// cookies, for that account alone.
type ESPN struct {
	Member ESPNMember
	Public ESPNPublic
	Now    func() time.Time
	Log    *slog.Logger
}

// Key is the host's contract name.
func (e *ESPN) Key() string { return HostESPN }

// Owns reports an ESPN address; a bare id is Sleeper's.
func (e *ESPN) Owns(pasted string) bool {
	_, err := espn.Parse(pasted)
	return err == nil && strings.Contains(strings.ToLower(pasted), "espn.com")
}

// Parse reads an ESPN league link or id; a link with no season names
// this season.
func (e *ESPN) Parse(pasted string) (Ref, error) {
	ref, err := espn.Parse(pasted)
	if err != nil {
		return Ref{}, ErrNotALink
	}
	if ref.Season == 0 {
		ref.Season = season.Of(e.Now())
	}
	return Ref{Host: HostESPN, LeagueID: ref.LeagueID, Season: ref.Season}, nil
}

// Read reads the league as ref says: with no account, as the public
// does, with no cookies at all; for an account that attached it as a
// member, with that account's cookies. When ESPN no longer takes that
// account's cookies a public league still reads as the public does, and a
// private one asks that account to connect again.
func (e *ESPN) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	if ref.As != uuid.Nil {
		snap, _, err := e.ReadAs(ctx, ref.As, ref)
		if !errors.Is(err, ErrSignInAgain) && !errors.Is(err, ErrNotConnected) {
			return snap, err
		}
	}
	l, err := e.Public.Read(ctx, ref.LeagueID, ref.Season, nil)
	if errors.Is(err, espn.ErrPrivate) && ref.As != uuid.Nil {
		return Snapshot{}, fmt.Errorf("%w: espn refused the member's cookies and the league is private", ErrSignInAgain)
	}
	if err != nil {
		return Snapshot{}, espnErr(err)
	}
	return espnSnapshot(l, e.Now()), nil
}

// ReadAs reads the league with one member's cookies, answering it and
// the member's team in it (the team their SWID owns, 0 for none).
func (e *ESPN) ReadAs(ctx context.Context, accountID uuid.UUID, ref Ref) (Snapshot, int, error) {
	cookies, err := e.Member.Cookies(ctx, accountID)
	if err != nil {
		return Snapshot{}, 0, espnErr(err)
	}
	l, err := e.Member.ReadLeague(ctx, accountID, ref.LeagueID, ref.Season)
	if err != nil {
		return Snapshot{}, 0, espnErr(err)
	}
	mine := 0
	for _, t := range l.Teams {
		for _, o := range t.Owners {
			if strings.EqualFold(o, cookies.SWID) {
				mine = t.ID
			}
		}
	}
	return espnSnapshot(l, e.Now()), mine, nil
}

// SeatByUsername: an ESPN team is picked from the list, or is the
// connected member's own.
func (e *ESPN) SeatByUsername(context.Context, Snapshot, string) (int, error) {
	return 0, ErrSeatByName
}

// Players: ESPN's players arrive with the league's read.
func (e *ESPN) Players(context.Context, int) ([]HostPlayer, error) { return nil, nil }

func espnErr(err error) error {
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return fmt.Errorf("%w: %v", ErrNotConnected, err)
	case errors.Is(err, espnhost.ErrReconnect), errors.Is(err, espn.ErrSignedOut):
		return fmt.Errorf("%w: %v", ErrSignInAgain, err)
	case errors.Is(err, espn.ErrPrivate):
		return fmt.Errorf("%w: %v", ErrPrivate, err)
	case errors.Is(err, espn.ErrNotFound), errors.Is(err, espn.ErrNotALink):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	default:
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
}

// espnSnapshot is an ESPN league's read as the snapshot every host fills.
func espnSnapshot(l espn.FullLeague, now time.Time) Snapshot {
	snap := Snapshot{
		Ref:  Ref{Host: HostESPN, LeagueID: l.ID, Season: l.Season},
		Name: scoring.HostText(l.Name), Season: l.Season, Week: l.ScoringPeriod,
		Players: map[string]HostPlayer{}, Moves: []Move{}, ReadAt: now,
		Calendar: Calendar{DraftAt: l.DraftAt, DraftUnstated: l.Draft == nil, PlayoffStartWeek: l.PlayoffStartWeek, WaiversClosed: l.Acquisition.Closed},
	}
	snap.Status = espnStatus(l)
	if l.Draft == nil {
		snap.Calendar.DraftReadBy = ReadByRosters
	}
	byID := map[int]Team{}
	for _, t := range l.Teams {
		against := round2(t.PointsAgainst)
		team := Team{RosterID: t.ID, Name: scoring.HostText(t.Name), Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: round2(t.PointsFor),
			PointsAgainst: &against, Streak: t.Streak, WaiverOrder: t.WaiverRank}
		if l.Acquisition.Budget && t.BudgetSpent != nil {
			left := max(l.Acquisition.Total-*t.BudgetSpent, 0)
			team.BudgetLeft = &left
		}
		if len(t.Owners) > 0 {
			team.Owner = scoring.HostText(l.Members[t.Owners[0]])
		}
		// The members' ids (SWIDs) that own the team: an offers read is
		// made only for a roster the cookies' member owns (Lane 279).
		team.OwnerIDs = append([]string(nil), t.Owners...)
		for _, p := range t.Roster {
			snap.Players[p.ID] = espnPlayer(p)
			team.Players = append(team.Players, p.ID)
			switch p.Slot {
			case espn.SlotBench:
			case espn.SlotReserve:
				team.Reserve = append(team.Reserve, p.ID)
			default:
				team.Starters = append(team.Starters, p.ID)
			}
		}
		byID[t.ID] = team
		snap.Teams = append(snap.Teams, team)
	}
	sort.Slice(snap.Teams, func(i, j int) bool { return snap.Teams[i].RosterID < snap.Teams[j].RosterID })
	for i, g := range l.Games {
		for _, side := range []struct {
			id      int
			points  float64
			unread  bool
			players map[string]float64
		}{{g.Home, g.HomePoints, g.HomeUnread, g.HomePlayerPoints}, {g.Away, g.Points, g.Unread, g.PlayerPoints}} {
			snap.Matchups = append(snap.Matchups, Side{
				RosterID: side.id, Game: i + 1, Points: round2(side.points), PointsUnread: side.unread, Starters: byID[side.id].Starters, PlayerPoints: espnPlayerPoints(side.players),
			})
		}
	}
	im := espn.Map(l.Items)
	snap.Scoring = Scoring{Rules: im.Rules, Dropped: scoring.DroppedWords(im.Dropped), DroppedRules: im.Dropped, Defaulted: im.Defaulted}
	snap.Shape = espnShape(l.LineupSlotCount, len(snap.Teams))
	snap.Terms = espnTerms(l)
	snap.Schedule = espnSchedule(l.Schedule)
	return snap
}

// espnPlayerPoints is a side's players' week points as the snapshot
// keeps them, at two places as every host's; empty where ESPN sent none.
func espnPlayerPoints(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for id, v := range in {
		out[id] = round2(v)
	}
	return out
}

// espnStatus is the league's state in ESPN's own flags: the scoring
// period past the season's final one is the season over; then
// draftDetail's inProgress and drafted. A read that carries no
// draftDetail is read by its rosters (anyone rostered has drafted), and
// the snapshot's calendar says the draft was unstated.
func espnStatus(l espn.FullLeague) string {
	switch {
	case l.FinalScoringPeriod > 0 && l.ScoringPeriod > l.FinalScoringPeriod:
		return StatusComplete
	case l.Draft == nil && anyRostered(l.Teams):
		return StatusInSeason
	case l.Draft == nil:
		return StatusPreDraft
	case l.Draft.InProgress:
		return StatusDrafting
	case !l.Draft.Drafted:
		return StatusPreDraft
	}
	return StatusInSeason
}

func anyRostered(teams []espn.Team) bool {
	for _, t := range teams {
		if len(t.Roster) > 0 {
			return true
		}
	}
	return false
}

// espnPlayer is one ESPN player in the snapshot's directory: ESPN's own
// id is the one our board's ids share; a defense is placed by its team.
func espnPlayer(p espn.Player) HostPlayer {
	hp := HostPlayer{ID: p.ID, Name: scoring.HostText(p.Name), Position: p.Position, Team: p.Team, InjuredReserve: p.Injured}
	if !strings.HasPrefix(p.ID, "-") && p.Position != posDEF {
		hp.ESPNID = p.ID
	}
	return hp
}

// espnShape counts the league's lineup by our slot names.
func espnShape(counts map[int]int, teams int) Shape {
	sh := Shape{Teams: teams}
	unfollowed := map[string]bool{}
	for slot, n := range counts {
		switch espn.SlotName(slot) {
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
		case posFlex:
			sh.Flex += n
		case posSuperFlex:
			sh.SuperFlex += n
		case posBench:
			sh.Bench += n
		case posReserve:
			// ESPN's IR slot takes a player ruled out as well (Lane 118, B79).
			sh.IR += n
			sh.IROut = sh.IR > 0
		default:
			unfollowed[espn.SlotName(slot)] = true
		}
	}
	sh.Unfollowed = sortedKeys(unfollowed)
	return sh
}
