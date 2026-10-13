package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// HostFFPC is FFPC, read server side as a connected member (founder
// ruling 2026-10-13): no public API, so the league's pages are read with
// the member's own FFPC session through internal/hosts/ffpc.
const HostFFPC = ffpc.Host

// rulesTTL is how long a league's rules read lasts: its scoring and
// lineup change rarely, so the two rules pages are read once a day.
const rulesTTL = 24 * time.Hour

// FFPCMember reads FFPC as a member. *ffpc.Member implements it.
type FFPCMember interface {
	ReadLeague(ctx context.Context, accountID uuid.UUID, ltuid string, rules bool) (ffpc.League, error)
	OpenLeague(ctx context.Context, accountID uuid.UUID, leagueID string) (string, error)
}

// FFPCReaders finds a connected member who has attached a league, to
// read it as. *Store implements it.
type FFPCReaders interface {
	FFPCReader(ctx context.Context, ref Ref) (accountID uuid.UUID, ltuid string, err error)
}

// FFPC is the FFPC host. One read per league per interval, as any host,
// read as whichever connected member last read it.
type FFPC struct {
	Member  FFPCMember
	Readers FFPCReaders
	Now     func() time.Time

	mu    sync.Mutex
	rules map[string]rulesEntry
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

// Read reads the league as a connected member who attached it.
//
// The read is shared by every member viewing the league, so one member's
// signed-out connection is not the viewer's news: the next connected
// member is tried once (the signed-out one is no longer a reader). Only
// when no connected member is left does the answer ask for a sign-in,
// which is then the viewer's own to give.
func (f *FFPC) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	for range 2 {
		accountID, ltuid, err := f.Readers.FFPCReader(ctx, ref)
		if err != nil {
			return Snapshot{}, err
		}
		snap, _, err := f.ReadAs(ctx, accountID, ltuid)
		if !errors.Is(err, ErrSignInAgain) && !errors.Is(err, ErrNotConnected) {
			return snap, err
		}
	}
	return Snapshot{}, fmt.Errorf("%w: two members signed out in one read", ErrUnavailable)
}

// ReadAs reads the league as one member, answering it and the member's
// team id in it.
func (f *FFPC) ReadAs(ctx context.Context, accountID uuid.UUID, ltuid string) (Snapshot, int, error) {
	l, err := f.read(ctx, accountID, ltuid)
	if err != nil {
		return Snapshot{}, 0, ffpcErr(err)
	}
	snap := ffpcSnapshot(l, f.Now())
	return snap, l.Banner.TeamID, nil
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
