package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/tenth"
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

// WeekReads is how many leagues the front door reads at once (Lane 66k M2):
// enough that ten leagues take about three rounds, few enough that one
// account never holds more than this many host reads in flight.
const WeekReads = 4

// ReadFailedWords is a league's sentence when its read failed on our side:
// the row stays with its last read, which the page names beside it.
const ReadFailedWords = "We could not read this league just now."

// Week is every league the account follows, newest first, each read as
// the in-season routes read it when it is in season, at most WeekReads at
// once. A read that fails, the host's or ours, keeps the row with a
// sentence; only the list itself failing is an error.
func (s *Service) Week(ctx context.Context, accountID uuid.UUID) ([]WeekRead, error) {
	list, err := s.Links.Attached(ctx, accountID)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: week: %w", err)
	}
	out := make([]WeekRead, len(list))
	var g errgroup.Group
	g.SetLimit(WeekReads)
	for i, a := range list {
		out[i] = WeekRead{ID: a.ID, Name: a.Name, Host: a.Ref.Host, TeamName: a.TeamName, Standing: standingOf(a.Teams, a.RosterID),
			Phase: a.Phase, LastReadAt: a.LastReadAt}
		if !inWeek(a.Phase.Phase) {
			continue
		}
		g.Go(func() error {
			// A panic in one league's read keeps its row with the sentence and
			// leaves the process and the others alone. Logged by counts alone.
			defer func() {
				if recover() != nil {
					s.Log.Error("leaguesync: week league panicked", "league", i+1, "of", len(list))
					out[i].Followed, out[i].Problem = nil, ReadFailedWords
				}
			}()
			s.readWeek(ctx, a, &out[i])
			return nil
		})
	}
	_ = g.Wait() // every read keeps its own error in its row
	return out, nil
}

// readWeek reads one league in season into its row, or says why it could
// not.
func (s *Service) readWeek(ctx context.Context, a Attached, row *WeekRead) {
	f, err := s.follow(ctx, a.Link)
	var host hostError
	switch {
	case errors.As(err, &host):
		s.Log.Warn("leaguesync: week", "link", a.ID, "host", a.Ref.Host, "err", err)
		row.Problem = HostProblemWords(a.Ref.Host, host.err)
	case err != nil:
		s.Log.Error("leaguesync: week", "link", a.ID, "err", err)
		row.Problem = ReadFailedWords
	default:
		// The fresh read's standing, not the row's last kept one.
		row.Followed, row.Standing = &f, standingOf(f.Snap.Teams, a.RosterID)
	}
}

// HostProblemWords is one sentence for a read the host stopped, naming
// the platform and what the member does, where there is something to do.
// The page names the row's last read beside it, so the sentence never
// does (Lane 66k rereview N4).
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
		return HostWords(host) + " is busy with other leagues right now."
	}
	return HostWords(host) + " is not answering right now."
}

// TeamOnWire is a team as the wire names it, its points for and against
// the tenth the standings print (tenth.Round, Lane 66k H1).
func TeamOnWire(t Team) apitypes.LeagueTeam {
	var against *float64
	if t.PointsAgainst != nil {
		v := tenth.Round(*t.PointsAgainst)
		against = &v
	}
	return apitypes.LeagueTeam{
		RosterId: t.RosterID, Name: t.Name, Owner: t.Owner, Wins: t.Wins, Losses: t.Losses, Ties: t.Ties, PointsFor: tenth.Round(t.PointsFor),
		PointsAgainst: against, Streak: orNil(t.Streak), WaiverOrder: positive(t.WaiverOrder), WaiverBudgetLeft: t.BudgetLeft,
		Avatar: orNil(t.Avatar),
	}
}
