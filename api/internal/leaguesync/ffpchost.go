package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// HostFFPC is FFPC, read server side as the member who attached the
// league (ruling 2026-10-15): no public API, so the league's pages are
// read with that member's own FFPC session through internal/hosts/ffpc,
// for their attachment alone.
const HostFFPC = ffpc.Host

// rulesTTL is how long a league's rules read lasts: its scoring and
// lineup change rarely, so the two rules pages are read once a day.
const rulesTTL = 24 * time.Hour

// FFPCMember reads FFPC as a member. *ffpc.Member implements it.
type FFPCMember interface {
	ReadLeague(ctx context.Context, accountID uuid.UUID, ltuid string, rules bool) (ffpc.League, error)
	OpenLeague(ctx context.Context, accountID uuid.UUID, leagueID string) (string, error)
}

// FFPCTeamKeys finds the league-team id of the account a league is read
// as (ref.As), from that account's own attachment. *Store implements it.
type FFPCTeamKeys interface {
	FFPCTeamKey(ctx context.Context, ref Ref) (ltuid string, err error)
}

// FFPC is the FFPC host: one read per attachment per interval, each read
// with the sign-in of the account that attached it, for that account
// alone (a host credential reads only for the account that stored it).
type FFPC struct {
	Member   FFPCMember
	TeamKeys FFPCTeamKeys
	// Weeks is the run's schedule, the source of the current week; nil
	// falls back to FFPC's own week.
	Weeks WeekSource
	Now   func() time.Time
	Log   *slog.Logger

	mu    sync.Mutex
	rules map[string]rulesEntry
	// columns are the unknown rosters headings already logged.
	columns sync.Map
}

type rulesEntry struct {
	rules *ffpc.Rules
	at    time.Time
}

// Key is the host's contract name.
func (f *FFPC) Key() string { return HostFFPC }

// Owns reports an FFPC address. A league is attached from the member's
// own list, by its league id, never by a link's league-team id.
func (f *FFPC) Owns(pasted string) bool {
	return strings.Contains(strings.ToLower(pasted), "myffpc.com")
}

var ffpcLeagueID = regexp.MustCompile(`^[0-9]{1,12}$`)

// Parse reads an FFPC league id, as the member's league list gives it. Its
// season is the league home banner's, set at attach, since FFPC keeps a
// league's id from season to season.
func (f *FFPC) Parse(pasted string) (Ref, error) {
	id := strings.TrimSpace(pasted)
	if !ffpcLeagueID.MatchString(id) {
		return Ref{}, ErrNotALink
	}
	return Ref{Host: HostFFPC, LeagueID: id}, nil
}

// Read reads the league as the account it is attached for, with that
// account's own league-team id. An FFPC league is never read for anyone
// else: a ref with no account, or an account with no attachment of its
// own, has no reader, and a lapsed sign-in is that member's alone to mend.
func (f *FFPC) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	if ref.As == uuid.Nil {
		return Snapshot{}, fmt.Errorf("%w: an FFPC league is read only as the account that attached it", ErrNotConnected)
	}
	ltuid, err := f.TeamKeys.FFPCTeamKey(ctx, ref)
	if err != nil {
		return Snapshot{}, err
	}
	snap, _, err := f.ReadAs(ctx, ref.As, ltuid)
	if err != nil {
		return Snapshot{}, err
	}
	snap.Ref.As = ref.As
	return snap, nil
}

// ReadAs reads the league as one member, answering it and the member's
// team id in it.
func (f *FFPC) ReadAs(ctx context.Context, accountID uuid.UUID, ltuid string) (Snapshot, int, error) {
	l, err := f.read(ctx, accountID, ltuid)
	if err != nil {
		return Snapshot{}, 0, ffpcErr(err)
	}
	f.nameColumns(l.OtherRosterColumns)
	snap := ffpcSnapshot(l, f.Now(), f.week(ctx, l))
	return snap, l.Banner.TeamID, nil
}

// nameColumns logs, once per process, each rosters page heading we do
// not know: its players are rostered with no mark, and the heading says
// what the page has grown.
func (f *FFPC) nameColumns(headings []string) {
	for _, h := range headings {
		if _, seen := f.columns.LoadOrStore(h, true); !seen {
			f.warn("leaguesync: ffpc rosters column we do not know", "heading", h)
		}
	}
}

// WeekSource is the NFL week a moment falls in, from the run's schedule.
// *boards.PGSource implements it.
type WeekSource interface {
	WeekAt(ctx context.Context, season int, at time.Time) (int, bool, error)
}

// week is the league's current week: the run's, from its kickoffs, with
// FFPC's own (its lineup page, else its schedule) as the cross-check,
// logged when the two differ, and the answer when the run has none.
func (f *FFPC) week(ctx context.Context, l ffpc.League) int {
	own := ffpcWeek(l, f.Now())
	if f.Weeks == nil || l.Banner.Season == 0 {
		return own
	}
	run, ok, err := f.Weeks.WeekAt(ctx, l.Banner.Season, f.Now())
	if err != nil || !ok {
		f.warn("leaguesync: ffpc week from the run", "league", l.Banner.LeagueID, "ok", ok, "err", err)
		return own
	}
	if run != own {
		f.warn("leaguesync: ffpc week differs from the run's", "league", l.Banner.LeagueID, "ffpc", own, "run", run)
	}
	return run
}

func (f *FFPC) warn(msg string, args ...any) {
	if f.Log != nil {
		f.Log.Warn(msg, args...)
	}
}

func (f *FFPC) read(ctx context.Context, accountID uuid.UUID, ltuid string) (ffpc.League, error) {
	f.mu.Lock()
	if f.rules == nil {
		f.rules = map[string]rulesEntry{}
	}
	cached := f.rules[ltuid]
	f.mu.Unlock()
	fresh := cached.rules != nil && f.Now().Sub(cached.at) < rulesTTL
	l, err := f.Member.ReadLeague(ctx, accountID, ltuid, !fresh)
	if err != nil {
		return ffpc.League{}, err
	}
	if fresh {
		l.Rules = cached.rules
	} else if l.Rules != nil {
		f.mu.Lock()
		f.rules[ltuid] = rulesEntry{rules: l.Rules, at: f.Now()}
		f.mu.Unlock()
	}
	return l, nil
}

// SeatByUsername: FFPC's seat is the member's own team, from the page.
func (f *FFPC) SeatByUsername(context.Context, Snapshot, string) (int, error) {
	return 0, ErrSeatByName
}

// Players: FFPC's players arrive with the league's own pages
// (Snapshot.Players); there is no directory to read.
func (f *FFPC) Players(context.Context, int) ([]HostPlayer, error) { return nil, nil }

// Errors a member read can end in, in leaguesync's terms.
var (
	// ErrNotConnected is an account with no FFPC connection.
	ErrNotConnected = errors.New("leaguesync: host not connected")
	// ErrHostOff is an FFPC league while FFPC is switched off here.
	ErrHostOff = errors.New("leaguesync: host is off here")
	// ErrSignInAgain is a connection FFPC signed out or locked.
	ErrSignInAgain = errors.New("leaguesync: sign in to the host again")
)

func ffpcErr(err error) error {
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return fmt.Errorf("%w: %v", ErrNotConnected, err)
	case errors.Is(err, ffpc.ErrNeedsSignIn):
		return fmt.Errorf("%w: %v", ErrSignInAgain, err)
	case errors.Is(err, ffpc.ErrBusy):
		return fmt.Errorf("%w: %v", ErrBusy, err)
	case errors.Is(err, ffpc.ErrNoSuchLeague):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, ffpc.ErrNotThisPage):
		// FFPC answered a page we do not read: the host is not answering
		// as we know it, never "not your league".
		return fmt.Errorf("%w: ffpc answered a page we do not read: %v", ErrUnavailable, err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	default:
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
}
