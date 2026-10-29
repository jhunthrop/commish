package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
)

// HostYahoo is Yahoo, read server side as a connected member through
// OAuth (internal/hosts/yahoo): a Yahoo league answers only its members.
const HostYahoo = yahoo.Host

// yahooIDsTTL is how long the Yahoo-to-board id map is kept: the research
// ingest refreshes it at most daily.
const yahooIDsTTL = 6 * time.Hour

// YahooMember reads Yahoo as a member. *yahoo.Member implements it.
type YahooMember interface {
	ReadLeague(ctx context.Context, accountID uuid.UUID, season int, leagueID string) (yahoo.League, error)
	Scoreboards(ctx context.Context, accountID uuid.UUID, season int, leagueID string, weeks []int) ([]yahoo.Scoreboard, error)
}

// HostIDs is a host's player id to our board's, from the research
// players table's host id columns (players.yahoo_id through the
// crosswalk). *boards.PGSource implements it.
type HostIDs interface {
	YahooIDs(ctx context.Context) (map[string]string, error)
}

// Yahoo is the Yahoo host: one read per attachment per interval, each
// read with the token of the account that attached it, for that account
// alone (a host credential reads only for the account that stored it).
type Yahoo struct {
	Member YahooMember
	// IDs places a Yahoo player on our board by id; nil places by name.
	IDs HostIDs
	Now func() time.Time
	Log *slog.Logger

	mu    sync.Mutex
	ids   map[string]string
	idsAt time.Time
}

// Key is the host's contract name.
func (y *Yahoo) Key() string { return HostYahoo }

// Owns reports a Yahoo fantasy football address.
func (y *Yahoo) Owns(pasted string) bool {
	return strings.Contains(strings.ToLower(pasted), "football.fantasysports.yahoo.com")
}

var (
	yahooLeagueID   = regexp.MustCompile(`^[0-9]{1,12}$`)
	yahooLeaguePath = regexp.MustCompile(`^/f1/([0-9]{1,12})(/.*)?$`)
)

// Parse reads a Yahoo league id, as the member's league list gives it,
// or a Yahoo league address. Its season is the league's own, set at
// attach from the read.
func (y *Yahoo) Parse(pasted string) (Ref, error) {
	s := strings.TrimSpace(pasted)
	if yahooLeagueID.MatchString(s) {
		return Ref{Host: HostYahoo, LeagueID: s}, nil
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Hostname(), "football.fantasysports.yahoo.com") {
		return Ref{}, ErrNotALink
	}
	m := yahooLeaguePath.FindStringSubmatch(u.Path)
	if m == nil {
		return Ref{}, ErrNotALink
	}
	return Ref{Host: HostYahoo, LeagueID: m[1]}, nil
}

// Read reads the league as the account it is attached for. A Yahoo
// league is never read for anyone else: a ref with no account has no
// reader.
func (y *Yahoo) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	if ref.As == uuid.Nil {
		return Snapshot{}, fmt.Errorf("%w: a Yahoo league is read only as the account that attached it", ErrNotConnected)
	}
	snap, _, err := y.ReadAs(ctx, ref.As, ref)
	return snap, err
}

// ReadAs reads the league as one member, answering it and the member's
// team in it (0 when the member has none there).
func (y *Yahoo) ReadAs(ctx context.Context, accountID uuid.UUID, ref Ref) (Snapshot, int, error) {
	l, err := y.Member.ReadLeague(ctx, accountID, ref.Season, ref.LeagueID)
	if err != nil {
		return Snapshot{}, 0, yahooErr(err)
	}
	snap := yahooSnapshot(l, y.boardIDs(ctx), y.Now())
	mine := 0
	for _, t := range l.Teams {
		if t.Mine {
			mine = t.ID
		}
	}
	return snap, mine, nil
}

// boardIDs is the Yahoo id map, read at most every yahooIDsTTL; a failed
// read keeps the last one (or none: the players are placed by name).
func (y *Yahoo) boardIDs(ctx context.Context) map[string]string {
	if y.IDs == nil {
		return nil
	}
	y.mu.Lock()
	defer y.mu.Unlock()
	if y.ids != nil && y.Now().Sub(y.idsAt) < yahooIDsTTL {
		return y.ids
	}
	ids, err := y.IDs.YahooIDs(ctx)
	if err != nil {
		if y.Log != nil {
			y.Log.Warn("leaguesync: yahoo ids", "err", err)
		}
		return y.ids
	}
	y.ids, y.idsAt = ids, y.Now()
	return ids
}

// SeatByUsername: the seat is the member's own team, from the read.
func (y *Yahoo) SeatByUsername(context.Context, Snapshot, string) (int, error) {
	return 0, ErrSeatByName
}

// Players: Yahoo's players arrive with the league's read
// (Snapshot.Players); there is no directory to read.
func (y *Yahoo) Players(context.Context, int) ([]HostPlayer, error) { return nil, nil }

func yahooErr(err error) error {
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return fmt.Errorf("%w: %v", ErrNotConnected, err)
	case errors.Is(err, yahoo.ErrReconnect):
		return fmt.Errorf("%w: %v", ErrSignInAgain, err)
	case errors.Is(err, yahoo.ErrBusy):
		return fmt.Errorf("%w: %v", ErrBusy, err)
	case errors.Is(err, yahoo.ErrNoSuchLeague):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	default:
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
}
