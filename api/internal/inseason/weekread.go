package inseason

import (
	"context"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the caption's Central clock on the distroless image

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/weekreads"
)

// WeekReads is the research store's written week reads, kept a minute
// (Lane 284). *weekreads.Live implements it.
type WeekReads interface {
	Read(ctx context.Context, playerID string, season, week int) *weekreads.Row
}

// captionZone is the zone the read's caption says its write in, as the
// run says it (research capsules/week/sheet.py CENTRAL, CENTRAL_SHORT).
var captionZone = mustZone("America/Chicago")

const captionZoneShort = "CT"

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// centralStamp is an instant as a page stamp says it, "Wed Oct 28, 9:00
// am CT" (research capsules/week/sheet.py central_stamp, the web's
// format/clock.ts stampAt).
func centralStamp(at time.Time) string {
	local := at.In(captionZone)
	hour := local.Hour() % 12
	if hour == 0 {
		hour = 12
	}
	half := "am"
	if local.Hour() >= 12 {
		half = "pm"
	}
	return local.Format("Mon Jan") + " " + strconv.Itoa(local.Day()) + ", " +
		strconv.Itoa(hour) + ":" + local.Format("04") + " " + half + " " + captionZoneShort
}

// writtenCaption is the run's caption for a standing read (research
// capsules/week/caption.py written_caption).
func writtenCaption(writtenAt time.Time, week int) string {
	return "Written " + centralStamp(writtenAt) + ", for week " + strconv.Itoa(week)
}

// weekKickedOff is whether his club's game of the week has kicked off at now
// (research nightly/build/pages.py _kicked_off): the run serves no read
// for a game under way, and the live read keeps that rule.
func weekKickedOff(games []boards.TeamWeek, team string, week int, now time.Time) bool {
	for _, g := range games {
		if g.Team == team && g.Week == week && !g.Kickoff.IsZero() && !g.Kickoff.After(now) {
			return true
		}
	}
	return false
}

// liveWeekRead is his newest written read for the board week (the week
// of the next game still to be played), as the run would serve it: nil
// with no store, no written read, a read that failed, or once his game of
// that week has kicked off.
func (s *Service) liveWeekRead(ctx context.Context, games []boards.TeamWeek, bp boards.Player, now time.Time) *apitypes.PlayerWeekRead {
	if s.WeekReads == nil {
		return nil
	}
	week := nextWeek(games)
	if week == 0 || weekKickedOff(games, bp.Team, week, now) {
		return nil
	}
	row := s.WeekReads.Read(ctx, bp.ID, s.Season, week)
	if row == nil {
		return nil
	}
	return wireWeekRead(*row)
}

// wireWeekRead is a stored read as the answer carries it, the run's
// RunWeekRead (pages.py week_read_json) with its source: the body
// trimmed, the projection to the tenth the card prints.
func wireWeekRead(row weekreads.Row) *apitypes.PlayerWeekRead {
	out := &apitypes.PlayerWeekRead{
		Week: row.Week, Body: strings.TrimSpace(row.Body), Caption: writtenCaption(row.WrittenAt, row.Week),
		Status: row.Status, WrittenAt: row.WrittenAt.UTC(), Source: apitypes.PlayerWeekReadSourceLlm,
	}
	if row.Call != nil {
		call := apitypes.PlayerWeekReadCall(*row.Call)
		out.Call = &call
	}
	if row.FactsAt != nil {
		at := row.FactsAt.UTC()
		out.FactsAt = &at
	}
	if row.Projection != nil {
		v := roundTenth(roundCents(*row.Projection))
		out.Projection = &v
	}
	return out
}
