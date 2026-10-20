// Package leaguerecord is the record in a member's own league (Lane 93,
// rulings 1b and 6): ESPN's projection for every player rostered in an
// attached ESPN league, read before the register sets the week's order,
// and his points once the week is played, kept in app.espn_week_reads;
// and, for each graded week, the lineup our set order picks from the
// member's roster against the lineup ESPN's projection picks, both scored
// as the league scores.
package leaguerecord

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// WeekReader reads one scoring period of an ESPN league. ESPNWeeks
// implements it.
type WeekReader interface {
	ReadWeek(ctx context.Context, ref leaguesync.Ref, period int) (espn.WeekRead, error)
}

// MemberWeeks reads a period with a member's cookies. *espnhost.Member
// implements it.
type MemberWeeks interface {
	ReadWeek(ctx context.Context, accountID uuid.UUID, leagueID string, season, period int) (espn.WeekRead, error)
}

// PublicWeeks reads a period of a public league. *espn.Client implements it.
type PublicWeeks interface {
	ReadWeek(ctx context.Context, id string, season, period int, cookies *espn.Cookies) (espn.WeekRead, error)
}

// ESPNWeeks reads a league as the member it is attached as, else as the
// public reads it, the way the league's own read falls back.
type ESPNWeeks struct {
	Member MemberWeeks
	Public PublicWeeks
	Log    *slog.Logger
}

// ReadWeek reads the period as ref.As when set; a member read ESPN
// refuses falls back to the public read, which a private league refuses.
func (e ESPNWeeks) ReadWeek(ctx context.Context, ref leaguesync.Ref, period int) (espn.WeekRead, error) {
	if ref.As != uuid.Nil {
		w, err := e.Member.ReadWeek(ctx, ref.As, ref.LeagueID, ref.Season, period)
		if err == nil {
			return w, nil
		}
		e.Log.Warn("leaguerecord: member read, trying the public read", "league", ref.Key(), "err", err)
	}
	return e.Public.ReadWeek(ctx, ref.LeagueID, ref.Season, period, nil)
}

// Captured is one capture pass's count: reads kept, reads skipped as
// private to every reader (a league its reading member left), reads that
// failed.
type Captured struct {
	Leagues, Read, Skipped, Failed, Rows int
}

// Periods is what a pass reads at the NFL week it runs in (Lane 93 review
// H2): the week itself, before its games, and the week before it, read
// again for its own period, so that week's points come with its rosters as
// they stood then, a starter dropped since included. Week 1 has none before.
func Periods(week int) []int {
	if week <= 1 {
		return []int{week}
	}
	return []int{week - 1, week}
}

// Capture reads every attached ESPN league of the season once for each
// period and keeps each read whole, at now. A league private to every
// reader is skipped and said so; a read that fails is counted and logged
// and the pass goes on; a store that fails ends it.
func Capture(ctx context.Context, store *Store, reader WeekReader, season int, periods []int, now time.Time, log *slog.Logger) (Captured, error) {
	refs, err := store.Leagues(ctx, season)
	if err != nil {
		return Captured{}, err
	}
	out := Captured{Leagues: len(refs)}
	for _, ref := range refs {
		for _, period := range periods {
			w, err := reader.ReadWeek(ctx, ref, period)
			switch {
			case errors.Is(err, espn.ErrPrivate):
				out.Skipped++
				log.Info("leaguerecord: espn week read skipped, the league is private and its reader is not in it",
					"league", ref.Shared().Key(), "period", period)
				continue
			case err != nil:
				out.Failed++
				log.Warn("leaguerecord: espn week read", "league", ref.Shared().Key(), "period", period, "err", err)
				continue
			}
			n, err := store.Put(ctx, ref.LeagueID, w, now)
			if err != nil {
				return out, fmt.Errorf("leaguerecord: keep %s: %w", ref.Shared().Key(), err)
			}
			out.Read++
			out.Rows += n
		}
	}
	return out, nil
}
