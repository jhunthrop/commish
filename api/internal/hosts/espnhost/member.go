// Package espnhost keeps a member's ESPN cookies (SWID and espn_s2) in the
// hosts vault and reads their private leagues with them: connecting,
// listing their leagues and disconnecting. ESPN offers no OAuth, so the
// member hands us the two cookies their ESPN sign-in set (through
// Disney's own sign-in widget on our page, or pasted from ESPN's site);
// the cookies last about a year, and a read ESPN refuses marks the
// connection for a reconnect. A public league follows by its link with
// none of this; connecting is one flow either way, and a session whose
// leagues are all public is kept unproven until a member read of a league
// the public cannot read proves it.
package espnhost

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

// Host is this host's key in the connections table and the contract.
const Host = "espn"

// ErrReconnect is a connection whose cookies ESPN no longer accepts.
var ErrReconnect = errors.New("espnhost: connect again")

// ErrNotAccepted is a connection kept unproven whose cookies ESPN refused:
// ESPN never accepted them, so it is not a session that stopped working.
// It is an ErrReconnect too.
var ErrNotAccepted = fmt.Errorf("%w: ESPN never accepted the kept cookies", ErrReconnect)

// Session keys in the vault.
const (
	keySWID = "swid"
	keyS2   = "espn_s2"
)

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	SignedOutAt(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error
	Proved(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// Reader reads ESPN. *espn.Client implements it.
type Reader interface {
	Read(ctx context.Context, id string, season int, cookies *espn.Cookies) (espn.FullLeague, error)
	MyLeagues(ctx context.Context, cookies espn.Cookies, season int) ([]espn.MyLeague, error)
	ReadWeek(ctx context.Context, id string, season, period int, cookies *espn.Cookies) (espn.WeekRead, error)
	PendingTrades(ctx context.Context, cookies espn.Cookies, league string, season int) ([]espn.PendingTrade, error)
}

// Member reads ESPN with a connected member's cookies. Public tells a
// league the public cannot read, whose read proves a session kept
// unproven.
type Member struct {
	Client Reader
	Public PublicReader
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger
}

// kept is a member's open session: the cookies, the wrapped key they were
// kept under (which guards marking them signed out or proven) and whether
// they are proven yet.
type kept struct {
	cookies espn.Cookies
	wrapped []byte
	proven  bool
}

// Seal is a new connection's cookies, sealed for the account, with no
// renewal: ESPN offers none.
func Seal(v *hosts.Vault, accountID uuid.UUID, c espn.Cookies) (hosts.Sealed, error) {
	return v.SealTokens(accountID.String(), Host, hosts.Session{keySWID: c.SWID, keyS2: c.S2}, hosts.Session{})
}

// Cookies is the member's kept cookies, for a connection that reads.
func (m *Member) Cookies(ctx context.Context, accountID uuid.UUID) (espn.Cookies, error) {
	k, err := m.open(ctx, accountID)
	return k.cookies, err
}

// open is the member's kept session, for a connection that reads.
func (m *Member) open(ctx context.Context, accountID uuid.UUID) (kept, error) {
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return kept{}, err
	}
	if conn.Status != hosts.StatusConnected {
		return kept{}, refused(conn.Proven)
	}
	wrapped := conn.Sealed.WrappedKey
	s, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, wrapped, "the kept cookies no longer open")
		return kept{}, ErrReconnect
	}
	if err != nil {
		return kept{}, fmt.Errorf("espnhost: open session: %w", err)
	}
	c := espn.Cookies{SWID: s[keySWID], S2: s[keyS2]}
	if !c.Valid() {
		m.signedOut(ctx, accountID, wrapped, "the kept cookies are out of shape")
		return kept{}, ErrReconnect
	}
	return kept{cookies: c, wrapped: wrapped, proven: conn.Proven}, nil
}

// refused is the error for cookies ESPN refused: ErrNotAccepted when they
// were never proven, ErrReconnect when they once worked.
func refused(proven bool) error {
	if proven {
		return ErrReconnect
	}
	return ErrNotAccepted
}

// Leagues is the member's football leagues in a season. A session kept
// unproven whose list holds a league checked private reads that league
// with the cookies before the list is answered, as the connect would
// have: the read proves the session, or ESPN's refusal signs it out. So a
// lifted SWID with a made-up espn_s2 never keeps reading a member's list
// through us once that list holds a private league.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]espn.MyLeague, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return nil, err
	}
	list, err := m.Client.MyLeagues(ctx, k.cookies, season)
	if err := m.after(ctx, accountID, k, err); err != nil {
		return nil, err
	}
	if k.proven {
		return list, nil
	}
	private := checkList(ctx, m.Public, m.Log, list, season).first(list, true)
	if private == "" {
		return list, nil
	}
	_, err = m.Client.Read(ctx, private, season, &k.cookies)
	if err := m.after(ctx, accountID, k, err); err != nil {
		return nil, err
	}
	if err := m.Store.Proved(ctx, accountID, Host, k.wrapped); err != nil {
		m.Log.Warn("espnhost: mark proven", "account", accountID, "err", err)
	}
	return list, nil
}

// ReadLeague is one whole read of a league as the member. ESPN refuses a
// private league to cookies that work but are not a member's of it as it
// refuses cookies that no longer work; the member's own league list tells
// the two apart, so a league they are not in never signs them out. A good
// read of a league the public cannot read proves a session kept unproven.
func (m *Member) ReadLeague(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (espn.FullLeague, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return espn.FullLeague{}, err
	}
	l, err := m.Client.Read(ctx, leagueID, season, &k.cookies)
	if errors.Is(err, espn.ErrSignedOut) && !m.inList(ctx, k.cookies, leagueID, season) {
		return espn.FullLeague{}, fmt.Errorf("%w: not a league of this member", espn.ErrPrivate)
	}
	if err := m.after(ctx, accountID, k, err); err != nil {
		return espn.FullLeague{}, err
	}
	if !k.proven {
		m.prove(ctx, accountID, k.wrapped, leagueID, season)
	}
	return l, nil
}

// ReadWeek reads one scoring period's rosters of a league with the
// member's cookies (Lane 93's capture of ESPN's projection), noting the
// read or marking refused cookies for a reconnect as ReadLeague does: ESPN
// refuses a private league to working cookies of someone not in it as it
// refuses cookies that stopped working, so a refusal for a league outside
// the member's own list is that league's refusal (espn.ErrPrivate), and the
// connection is kept (Lane 93 review H1).
func (m *Member) ReadWeek(ctx context.Context, accountID uuid.UUID, leagueID string, season, period int) (espn.WeekRead, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return espn.WeekRead{}, err
	}
	w, err := m.Client.ReadWeek(ctx, leagueID, season, period, &k.cookies)
	if errors.Is(err, espn.ErrSignedOut) && !m.inList(ctx, k.cookies, leagueID, season) {
		return espn.WeekRead{}, fmt.Errorf("%w: not a league of this member", espn.ErrPrivate)
	}
	if err := m.after(ctx, accountID, k, err); err != nil {
		return espn.WeekRead{}, err
	}
	return w, nil
}

// PendingTrades is the league's open trade proposals as the member's
// cookies are shown them (Lane 279). A refusal is handled as ReadWeek's
// is: a league outside the member's own list is that league's refusal.
func (m *Member) PendingTrades(ctx context.Context, accountID uuid.UUID, leagueID string, season int) ([]espn.PendingTrade, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return nil, err
	}
	list, err := m.Client.PendingTrades(ctx, k.cookies, leagueID, season)
	if errors.Is(err, espn.ErrSignedOut) && !m.inList(ctx, k.cookies, leagueID, season) {
		return nil, fmt.Errorf("%w: not a league of this member", espn.ErrPrivate)
	}
	if err := m.after(ctx, accountID, k, err); err != nil {
		return nil, err
	}
	return list, nil
}

// prove marks the session proven when the league just read with it is
// one the public cannot read. A check ESPN does not answer proves
// nothing; a later read tries again.
func (m *Member) prove(ctx context.Context, accountID uuid.UUID, wrapped []byte, leagueID string, season int) {
	public, err := m.Public.Public(ctx, leagueID, season)
	if err != nil {
		m.Log.Warn("espnhost: public check", "account", accountID, "err", err)
		return
	}
	if public {
		return
	}
	if err := m.Store.Proved(ctx, accountID, Host, wrapped); err != nil {
		m.Log.Warn("espnhost: mark proven", "account", accountID, "err", err)
	}
}

// inList reports whether the cookies still read the member's list and
// it does not hold the league, which is a league they are not in; any
// other answer is the cookies refused.
func (m *Member) inList(ctx context.Context, c espn.Cookies, leagueID string, season int) bool {
	list, err := m.Client.MyLeagues(ctx, c, season)
	if err != nil {
		return true
	}
	for _, l := range list {
		if l.LeagueID == leagueID {
			return true
		}
	}
	return false
}

// after notes a good read, or marks a refused one for a reconnect.
func (m *Member) after(ctx context.Context, accountID uuid.UUID, k kept, err error) error {
	if errors.Is(err, espn.ErrSignedOut) {
		m.signedOut(ctx, accountID, k.wrapped, "ESPN refused the cookies")
		return refused(k.proven)
	}
	if err != nil {
		return err
	}
	if err := m.Store.Read(ctx, accountID, Host, m.Now()); err != nil {
		m.Log.Warn("espnhost: note read", "account", accountID, "err", err)
	}
	return nil
}

// signedOut marks the connection the read began with for a reconnect;
// a connection made again since keeps its state.
func (m *Member) signedOut(ctx context.Context, accountID uuid.UUID, wrapped []byte, why string) {
	m.Log.Warn("espnhost: connection needs a reconnect", "account", accountID, "why", why)
	if err := m.Store.SignedOutAt(ctx, accountID, Host, wrapped); err != nil {
		m.Log.Warn("espnhost: mark signed out", "account", accountID, "err", err)
	}
}
