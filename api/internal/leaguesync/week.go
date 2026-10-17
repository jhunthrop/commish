package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// WeekRead is one league the account follows as the front door reads it
// (Lane 66k): the attached row, and in season the league as the in-season
// routes read it, or the sentence saying why the read stopped. The row
// is kept either way, so a failed read never drops the league.
type WeekRead struct {
	ID       uuid.UUID
	Name     string
	Host     string
	TeamName string
	Standing *apitypes.LeagueStanding
	Phase    LeaguePhase
	// LastReadAt is the link's last read, the row's when Followed is nil.
	LastReadAt *time.Time
	// Followed is the league as the in-season routes read it, nil out of
	// season or when the read failed.
	Followed *Followed
	// Problem says why a league in season has no read, naming the
	// platform; empty otherwise.
	Problem string
}

// inWeek reports a phase whose league has a week the front door shows.
func inWeek(p apitypes.LeaguePhase) bool {
	return p == apitypes.LeaguePhaseInSeason || p == apitypes.LeaguePhasePlayoffs
}

// Week is every league the account follows, newest first, each read as
// the in-season routes read it when it is in season. A read the host
// stopped keeps the row with a sentence; any other error stops the list.
func (s *Service) Week(ctx context.Context, accountID uuid.UUID) ([]WeekRead, error) {
	list, err := s.Links.Attached(ctx, accountID)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: week: %w", err)
	}
	out := make([]WeekRead, 0, len(list))
	for _, a := range list {
		row := WeekRead{ID: a.ID, Name: a.Name, Host: a.Ref.Host, TeamName: a.TeamName, Standing: standingOf(a.Teams, a.RosterID),
			Phase: a.Phase, LastReadAt: a.LastReadAt}
		if inWeek(a.Phase.Phase) {
			f, err := s.follow(ctx, a.Link)
			var host hostError
			switch {
			case errors.As(err, &host):
				s.Log.Warn("leaguesync: week", "link", a.ID, "host", a.Ref.Host, "err", err)
				row.Problem = HostProblemWords(a.Ref.Host, host.err)
			case err != nil:
				return nil, fmt.Errorf("leaguesync: week: %w", err)
			default:
				// The fresh read's standing, not the row's last kept one.
				row.Followed, row.Standing = &f, standingOf(f.Snap.Teams, a.RosterID)
			}
		}
		out = append(out, row)
	}
	return out, nil
}

// HostProblemWords is one sentence for a read the host stopped, naming
// the platform and what the member does, where there is something to do.
func HostProblemWords(host string, err error) string {
	words := wordsFor(host)
	switch {
	case errors.Is(err, ErrHostOff):
		return words.off
	case errors.Is(err, ErrNotConnected):
		return words.noReader
	case errors.Is(err, ErrSignInAgain):
		return words.again
	case errors.Is(err, ErrBusy):
		return HostWords(host) + " is busy with other leagues right now. Your standing is from the last read."
	}
	return HostWords(host) + " is not answering right now. Your standing is from the last read."
}

// TeamOnWire is a team as the wire names it.
func TeamOnWire(t Team) apitypes.LeagueTeam {
	return apitypes.LeagueTeam{
		RosterId: t.RosterID, Name: t.Name, Owner: t.Owner, Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: t.PointsFor,
		PointsAgainst: t.PointsAgainst, Streak: orNil(t.Streak), WaiverOrder: positive(t.WaiverOrder), WaiverBudgetLeft: t.BudgetLeft,
		Avatar: orNil(t.Avatar),
	}
}
