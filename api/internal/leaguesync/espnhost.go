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

// ESPN's lineup slots that hold no starter.
const (
	espnBench   = 20
	espnReserve = 21
)

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

// ESPN is the ESPN host.
type ESPN struct {
	Member  ESPNMember
	Public  ESPNPublic
	Readers MemberReaders
	Now     func() time.Time
	Log     *slog.Logger
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

// Read reads the league with the cookies of a connected member who
// follows it, or as the public does when none is: a public league needs
// nobody, and a member whose cookies ESPN refused is not the viewer's
// news while the league is public.
func (e *ESPN) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	accountID, err := e.Readers.MemberReader(ctx, ref)
	if err != nil && !errors.Is(err, ErrNotConnected) {
		return Snapshot{}, err
	}
	if err == nil {
		snap, _, err := e.ReadAs(ctx, accountID, ref)
		if !errors.Is(err, ErrSignInAgain) && !errors.Is(err, ErrNotConnected) {
			return snap, err
		}
	}
	l, err := e.Public.Read(ctx, ref.LeagueID, ref.Season, nil)
	if errors.Is(err, espn.ErrPrivate) && accountID != uuid.Nil {
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
		Name: scoring.HostText(l.Name), Status: "in_season", Season: l.Season, Week: l.ScoringPeriod,
		Players: map[string]HostPlayer{}, Moves: []Move{}, ReadAt: now,
	}
	byID := map[int]Team{}
	for _, t := range l.Teams {
		team := Team{RosterID: t.ID, Name: scoring.HostText(t.Name), Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: round2(t.PointsFor)}
		if len(t.Owners) > 0 {
			team.Owner = scoring.HostText(l.Members[t.Owners[0]])
		}
		for _, p := range t.Roster {
			snap.Players[p.ID] = espnPlayer(p)
			team.Players = append(team.Players, p.ID)
			switch p.Slot {
			case espnBench:
			case espnReserve:
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
			id     int
			points float64
		}{{g.Home, g.HomePoints}, {g.Away, g.Points}} {
			snap.Matchups = append(snap.Matchups, Side{
				RosterID: side.id, Game: i + 1, Points: round2(side.points), Starters: byID[side.id].Starters, PlayerPoints: map[string]float64{},
			})
		}
	}
	im := espn.Map(l.Items)
	snap.Scoring = Scoring{Rules: im.Rules, Dropped: scoring.DroppedWords(im.Dropped), DroppedRules: im.Dropped, Defaulted: im.Defaulted}
	snap.Shape = espnShape(l.LineupSlotCount, len(snap.Teams))
	return snap
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
		default:
			unfollowed[espn.SlotName(slot)] = true
		}
	}
	sh.Unfollowed = sortedKeys(unfollowed)
	return sh
}
