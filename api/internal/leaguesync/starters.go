package leaguesync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
)

// StartingPlayer is one player in a lineup, placed on our board.
type StartingPlayer struct {
	BoardID  string
	Name     string
	Position string
	Team     string
}

// LeagueStarters is one followed league's starting lineup for the member
// who follows it: the attachment, the league's name and the starters we
// could place on our board.
type LeagueStarters struct {
	LinkID     uuid.UUID
	LeagueName string
	Players    []StartingPlayer
}

// AttachedLinks is the part of Store the starters read lists links with.
type AttachedLinks interface {
	Attached(ctx context.Context, accountID uuid.UUID) ([]Attached, error)
}

// SnapshotReads is a league's last good read.
type SnapshotReads interface {
	LastSnapshot(ctx context.Context, ref Ref) (Snapshot, bool, error)
}

// StoredDirectory is the hosts' directories as the store keeps them.
type StoredDirectory interface {
	HostPlayersByID(ctx context.Context, host string, ids []string) (map[string]HostPlayer, error)
}

// StoredStarters is each followed league's starters from what the API's
// background reads already kept (the league's last good read and the
// host's kept directory), never a host itself: the push job reads it
// with nothing but the database (Lane 262 re-review N1, N3). A league the
// API has not read yet has no starters here.
type StoredStarters struct {
	Links     AttachedLinks
	Snapshots SnapshotReads
	Directory StoredDirectory
	Boards    BoardSource
	Log       *slog.Logger
}

// Starters is the starting lineup of the member's team in each league the
// account follows, each starter placed on our board as the league page
// places him (Place). A league with no kept read, or whose directory or
// board fails, is left out and logged, never the whole answer.
func (s *StoredStarters) Starters(ctx context.Context, accountID uuid.UUID) ([]LeagueStarters, error) {
	attached, err := s.Links.Attached(ctx, accountID)
	if err != nil {
		return nil, err
	}
	out := make([]LeagueStarters, 0, len(attached))
	for _, a := range attached {
		league, ok, err := s.leagueStarters(ctx, a.Link)
		if err != nil {
			s.Log.Warn("leaguesync: starters", "league", a.Ref.Key(), "account_id", accountID, "err", err)
			continue
		}
		if !ok {
			continue
		}
		if league.LeagueName == "" {
			league.LeagueName = a.Name
		}
		out = append(out, league)
	}
	return out, nil
}

// leagueStarters is one link's lineup on our board, ok false with no kept
// read.
func (s *StoredStarters) leagueStarters(ctx context.Context, link Link) (LeagueStarters, bool, error) {
	snap, ok, err := s.Snapshots.LastSnapshot(ctx, link.Ref)
	if err != nil || !ok {
		return LeagueStarters{}, false, err
	}
	out := LeagueStarters{LinkID: link.ID, LeagueName: snap.Name}
	team, found := snap.TeamByRoster(link.RosterID)
	if !found || len(team.Starters) == 0 {
		return out, true, nil
	}
	dir := snap.Players
	if dir == nil {
		if dir, err = s.Directory.HostPlayersByID(ctx, snap.Ref.Host, team.Starters); err != nil {
			return LeagueStarters{}, false, fmt.Errorf("leaguesync: directory: %w", err)
		}
	}
	board, err := s.Boards.For(ctx, ValuationSettings(snap, nil))
	if err != nil {
		return LeagueStarters{}, false, fmt.Errorf("leaguesync: board: %w", err)
	}
	placed := Place(board.Raw, dir, team.Starters)
	for _, id := range team.Starters {
		pl, ok := placed[id]
		if !ok {
			continue
		}
		p := StartingPlayer{BoardID: pl.BoardID}
		if hp, ok := dir[id]; ok {
			p.Name, p.Position, p.Team = hp.Name, hp.Position, ourTeam(hp.Team)
		}
		out.Players = append(out.Players, p)
	}
	return out, true, nil
}
