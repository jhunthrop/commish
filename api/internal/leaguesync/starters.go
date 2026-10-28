package leaguesync

import (
	"context"
	"fmt"

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

// Starters is the starting lineup of the member's team in each league the
// account follows, from the read every screen reads (the poller's), each
// starter placed on our board as the league page places him (Place). The
// starter status push reads it (Lane 262). A league whose read or board
// fails is left out and logged, never the whole answer.
func (s *Service) Starters(ctx context.Context, accountID uuid.UUID) ([]LeagueStarters, error) {
	attached, err := s.Links.Attached(ctx, accountID)
	if err != nil {
		return nil, err
	}
	out := make([]LeagueStarters, 0, len(attached))
	for _, a := range attached {
		league, err := s.leagueStarters(ctx, a.Link)
		if err != nil {
			s.Log.Warn("leaguesync: starters", "league", a.Ref.Key(), "account_id", accountID, "err", err)
			continue
		}
		if league.LeagueName == "" {
			league.LeagueName = a.Name
		}
		out = append(out, league)
	}
	return out, nil
}

// leagueStarters is one link's lineup on our board.
func (s *Service) leagueStarters(ctx context.Context, link Link) (LeagueStarters, error) {
	read, err := s.Poller.Read(ctx, link.Ref)
	if err != nil {
		return LeagueStarters{}, err
	}
	snap := read.Snapshot
	out := LeagueStarters{LinkID: link.ID, LeagueName: snap.Name}
	team, ok := snap.TeamByRoster(link.RosterID)
	if !ok || len(team.Starters) == 0 {
		return out, nil
	}
	dir := snap.Players
	if dir == nil {
		if dir, err = s.Players.For(ctx, snap.Ref.Host, directorySeason(snap, s.Now()), team.Starters); err != nil {
			return LeagueStarters{}, fmt.Errorf("leaguesync: directory: %w", err)
		}
	}
	board, err := s.Boards.For(ctx, ValuationSettings(snap, nil))
	if err != nil {
		return LeagueStarters{}, fmt.Errorf("leaguesync: board: %w", err)
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
	return out, nil
}
