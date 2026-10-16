package season

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// The site's season phases (spec 2026-10-16 §1), as /me.season names them.
const (
	SitePreseason = "preseason"
	SiteInSeason  = "in_season"
	SitePlayoffs  = "playoffs"
	SiteOffseason = "offseason"
)

// NFL postseason weeks: the wild-card round is week 19 and the Super Bowl
// week 22 (the bye before it counts toward it).
const (
	firstPlayoffWeek = 19
	lastPlayoffWeek  = 22
	daysPerWeek      = 7
)

// superBowlAfterLastGame is the days from the last regular-season game
// day to Super Bowl Sunday: wild card, divisional, conference, the bye,
// then the game, five weeks on (2026-01-04 to 2026-02-08, 2027-01-10 to
// 2027-02-14). It stands only while the schedule carries no Super Bowl.
const superBowlAfterLastGame = 5 * daysPerWeek

// siteTTL is how long the site's season is kept in process.
const siteTTL = time.Hour

// SiteFacts are the facts the site's season is read from: the kickoffs
// the API already reads for the in-season screens, and whether a
// season's first preseason board is out. *boards.PGSource implements it.
type SiteFacts interface {
	Schedule
	// LastGameDay is the season's last regular-season game day, false
	// while its schedule is not loaded.
	LastGameDay(ctx context.Context, season int) (time.Time, bool, error)
	// WeekAt is the NFL week a moment falls in.
	WeekAt(ctx context.Context, season int, at time.Time) (int, bool, error)
	// PostseasonEnd is the last postseason week the schedule carries and
	// the day its last game is played, false while it carries none.
	PostseasonEnd(ctx context.Context, season int) (int, time.Time, bool, error)
	// BoardWeek is the first week the published board covers, false
	// while the site shows the preseason board.
	BoardWeek(ctx context.Context, season int) (int, bool, error)
	// PreseasonBoard is whether a preseason board is stored for the season.
	PreseasonBoard(ctx context.Context, season int) (bool, error)
}

// SitePhase is the NFL season the site is in, the week in play, and the
// one sentence naming the fact it came from.
type SitePhase struct {
	Phase string
	Week  int
	Basis string
	// BoardWeek is the first week the published board covers, 0 when the
	// site shows the preseason board or the phase is not in season.
	BoardWeek int
	// Opener is the coming season's first kickoff in the preseason, zero
	// when its schedule is not loaded or the season is under way.
	Opener time.Time
	// Unread says no read of the schedule has succeeded: the phase is a
	// stand-in, not a fact.
	Unread bool
}

// OpenerDay is a kickoff's day as a sentence names it, Eastern:
// "Wednesday, September 9".
func OpenerDay(t time.Time) string { return t.In(Eastern()).Format("Monday, January 2") }

// SiteAt is the site's season at now: from week 1's first kickoff to the
// end of the last regular-season game day is in season, then the NFL
// playoffs to the end of Super Bowl day, then the offseason until the
// next season's first preseason board, and the preseason from that board
// to the next opener.
func SiteAt(ctx context.Context, facts SiteFacts, now time.Time) (SitePhase, error) {
	y := Of(now)
	first, loaded, err := facts.FirstKickoff(ctx, y)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: site at %s: %w", now, err)
	}
	if !loaded || now.Before(first) {
		return beforeKickoff(ctx, facts, y, first, loaded)
	}
	last, ok, err := facts.LastGameDay(ctx, y)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: site at %s: %w", now, err)
	}
	if !ok {
		return SitePhase{}, fmt.Errorf("season: site at %s: the %d schedule has a first kickoff and no last game", now, y)
	}
	regularEnd := time.Date(last.Year(), last.Month(), last.Day()+1, 0, 0, 0, 0, Eastern())
	if now.Before(regularEnd) {
		return inSeason(ctx, facts, y, now)
	}
	end, err := superBowlOf(ctx, facts, y, last)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: site at %s: %w", now, err)
	}
	superBowlEnd := time.Date(end.day.Year(), end.day.Month(), end.day.Day()+1, 0, 0, 0, 0, Eastern())
	if now.Before(superBowlEnd) {
		days := int(now.Sub(regularEnd).Hours()) / 24
		week := min(firstPlayoffWeek+max(days-1, 0)/daysPerWeek, lastPlayoffWeek)
		return SitePhase{Phase: SitePlayoffs, Week: week, Basis: fmt.Sprintf("The %d regular season is over and the NFL playoffs are on.", y)}, nil
	}
	// After the Super Bowl and before March 1 the next season's board may
	// already be out.
	next, scheduled, err := facts.FirstKickoff(ctx, y+1)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: site at %s: %w", now, err)
	}
	return beforeKickoff(ctx, facts, y+1, next, scheduled)
}

// boardUnread is the sentence added when the published board's week
// could not be read.
const boardUnread = "Our board's week could not be read just now."

// inSeason is the site's season in a regular-season week, and when the
// published board starts from another week, the sentence saying so.
func inSeason(ctx context.Context, facts SiteFacts, y int, now time.Time) (SitePhase, error) {
	week, ok, err := facts.WeekAt(ctx, y, now)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: site at %s: %w", now, err)
	}
	if !ok {
		return SitePhase{}, fmt.Errorf("season: site at %s: the %d schedule has no week for it", now, y)
	}
	basis := fmt.Sprintf("Week %d of the %d NFL season is under way.", week, y)
	boardWeek, shown, err := facts.BoardWeek(ctx, y)
	if err != nil {
		// The season does not depend on the board: answer it, and say the
		// board's week is unknown.
		return SitePhase{Phase: SiteInSeason, Week: week, Basis: basis + " " + boardUnread}, nil
	}
	if !shown {
		return SitePhase{Phase: SiteInSeason, Week: week, Basis: basis}, nil
	}
	if boardWeek < week {
		basis = fmt.Sprintf("Week %d has begun. Our board is still the week %d board until Tuesday's refresh.", week, boardWeek)
	}
	return SitePhase{Phase: SiteInSeason, Week: week, BoardWeek: boardWeek, Basis: basis}, nil
}

// superBowl is the day season y's Super Bowl is played, midnight Eastern,
// and whether the schedule says so or it is counted from the last
// regular-season game.
type superBowl struct {
	day  time.Time
	read bool
}

// superBowlOf is season y's Super Bowl: the last game day of a schedule
// that carries the postseason through its final week, else the days a
// season has run from lastGame, the last regular-season game day.
func superBowlOf(ctx context.Context, facts SiteFacts, y int, lastGame time.Time) (superBowl, error) {
	week, day, carried, err := facts.PostseasonEnd(ctx, y)
	if err != nil {
		return superBowl{}, fmt.Errorf("season: postseason end %d: %w", y, err)
	}
	if carried && week >= lastPlayoffWeek {
		return superBowl{day: day, read: true}, nil
	}
	counted := time.Date(lastGame.Year(), lastGame.Month(), lastGame.Day()+superBowlAfterLastGame, 0, 0, 0, 0, Eastern())
	return superBowl{day: counted}, nil
}

// superBowlNote is the offseason sentence saying where season y's Super
// Bowl day came from, empty while y's schedule is not loaded.
func superBowlNote(ctx context.Context, facts SiteFacts, y int) (string, error) {
	last, loaded, err := facts.LastGameDay(ctx, y)
	if err != nil {
		return "", fmt.Errorf("season: last game day %d: %w", y, err)
	}
	if !loaded {
		return "", nil
	}
	bowl, err := superBowlOf(ctx, facts, y, last)
	if err != nil {
		return "", err
	}
	if bowl.read {
		return fmt.Sprintf(" The Super Bowl was played on %s.", OpenerDay(bowl.day)), nil
	}
	return " The schedule does not carry the Super Bowl, so it is counted five weeks after the last regular-season game.", nil
}

// beforeKickoff is the site's season before season y's opener: the
// preseason once y's first preseason board is out, else the offseason
// after season y-1. first is y's first kickoff, when scheduled says y's
// schedule is loaded.
func beforeKickoff(ctx context.Context, facts SiteFacts, y int, first time.Time, scheduled bool) (SitePhase, error) {
	board, err := facts.PreseasonBoard(ctx, y)
	if err != nil {
		return SitePhase{}, fmt.Errorf("season: preseason board %d: %w", y, err)
	}
	switch {
	case board && scheduled:
		return SitePhase{Phase: SitePreseason, Opener: first,
			Basis: fmt.Sprintf("The %d boards are out and week 1 kicks off %s.", y, OpenerDay(first))}, nil
	case board:
		return SitePhase{Phase: SitePreseason, Basis: fmt.Sprintf("The %d boards are out and the %d schedule is not loaded yet.", y, y)}, nil
	}
	note, err := superBowlNote(ctx, facts, y-1)
	if err != nil {
		return SitePhase{}, err
	}
	return SitePhase{Phase: SiteOffseason, Basis: fmt.Sprintf("The %d season is over and the %d boards are not out yet.%s", y-1, y, note)}, nil
}

// siteRetry is how long a failed read stands before the facts are read
// again, so an outage costs one read a minute, not one a request.
const siteRetry = time.Minute

// Site keeps the site's season in process for an hour. A failed read is
// logged and answers the last good one (with none yet, the preseason,
// saying the schedule could not be read) for a minute before the next
// try. The lock is never held across a read.
type Site struct {
	Facts SiteFacts
	Now   func() time.Time
	Log   *slog.Logger

	mu      sync.Mutex
	kept    SitePhase
	at      time.Time
	retryAt time.Time
}

// unread is the answer before any read has succeeded.
var unread = SitePhase{Phase: SitePreseason, Unread: true, Basis: "We could not read the NFL schedule, so the site reads as before the season."}

// Phase is the site's season now.
func (s *Site) Phase(ctx context.Context) SitePhase {
	now := s.Now()
	s.mu.Lock()
	kept, at, retryAt := s.kept, s.at, s.retryAt
	s.mu.Unlock()
	if !at.IsZero() && now.Sub(at) < siteTTL {
		return kept
	}
	if now.Before(retryAt) {
		return lastGood(kept, at)
	}
	got, err := SiteAt(ctx, s.Facts, now)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("season: the site's season could not be read", "err", err)
		}
		s.retryAt = now.Add(siteRetry)
		return lastGood(s.kept, s.at)
	}
	s.kept, s.at = got, now
	return got
}

// lastGood is the last good answer, or unread when there is none.
func lastGood(kept SitePhase, at time.Time) SitePhase {
	if at.IsZero() {
		return unread
	}
	return kept
}
