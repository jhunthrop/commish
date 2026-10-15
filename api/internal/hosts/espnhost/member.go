// Package espnhost keeps a member's ESPN cookies (SWID and espn_s2) in the
// hosts vault and reads their private leagues with them: connecting,
// listing their leagues and disconnecting. ESPN offers no OAuth, so the
// member hands us the two cookies their ESPN sign-in set (through
// Disney's own sign-in widget on our page, or pasted from ESPN's site);
// the cookies last about a year, and a read ESPN refuses marks the
// connection for a reconnect. A public league needs none of this.
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

// Session keys in the vault.
const (
	keySWID = "swid"
	keyS2   = "espn_s2"
)

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	SignedOutAt(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// Reader reads ESPN. *espn.Client implements it.
type Reader interface {
	Read(ctx context.Context, id string, season int, cookies *espn.Cookies) (espn.FullLeague, error)
	MyLeagues(ctx context.Context, cookies espn.Cookies, season int) ([]espn.MyLeague, error)
}

// Member reads ESPN with a connected member's cookies.
type Member struct {
	Client Reader
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger
}

// Seal is a new connection's cookies, sealed for the account, with no
// renewal: ESPN offers none.
func Seal(v *hosts.Vault, accountID uuid.UUID, c espn.Cookies) (hosts.Sealed, error) {
	return v.SealTokens(accountID.String(), Host, hosts.Session{keySWID: c.SWID, keyS2: c.S2}, hosts.Session{})
}

// Cookies is the member's kept cookies, for a connection that reads.
func (m *Member) Cookies(ctx context.Context, accountID uuid.UUID) (espn.Cookies, error) {
	c, _, err := m.open(ctx, accountID)
	return c, err
}

// open is the member's kept cookies and the wrapped key they were kept
// under, which guards marking them signed out.
func (m *Member) open(ctx context.Context, accountID uuid.UUID) (espn.Cookies, []byte, error) {
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return espn.Cookies{}, nil, err
	}
	if conn.Status != hosts.StatusConnected {
		return espn.Cookies{}, nil, ErrReconnect
	}
	wrapped := conn.Sealed.WrappedKey
	s, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, wrapped, "the kept cookies no longer open")
		return espn.Cookies{}, nil, ErrReconnect
	}
	if err != nil {
		return espn.Cookies{}, nil, fmt.Errorf("espnhost: open session: %w", err)
	}
	c := espn.Cookies{SWID: s[keySWID], S2: s[keyS2]}
	if !c.Valid() {
		m.signedOut(ctx, accountID, wrapped, "the kept cookies are out of shape")
		return espn.Cookies{}, nil, ErrReconnect
	}
	return c, wrapped, nil
}

// Leagues is the member's football leagues in a season.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]espn.MyLeague, error) {
	c, wrapped, err := m.open(ctx, accountID)
	if err != nil {
		return nil, err
	}
	list, err := m.Client.MyLeagues(ctx, c, season)
	return list, m.after(ctx, accountID, wrapped, err)
}

// ReadLeague is one whole read of a league as the member. ESPN refuses a
// private league to cookies that work but are not a member's of it as it
// refuses cookies that no longer work; the member's own league list tells
// the two apart, so a league they are not in never signs them out.
func (m *Member) ReadLeague(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (espn.FullLeague, error) {
	c, wrapped, err := m.open(ctx, accountID)
	if err != nil {
		return espn.FullLeague{}, err
	}
	l, err := m.Client.Read(ctx, leagueID, season, &c)
	if errors.Is(err, espn.ErrSignedOut) && !m.inList(ctx, c, leagueID, season) {
		return espn.FullLeague{}, fmt.Errorf("%w: not a league of this member", espn.ErrPrivate)
	}
	return l, m.after(ctx, accountID, wrapped, err)
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
func (m *Member) after(ctx context.Context, accountID uuid.UUID, wrapped []byte, err error) error {
	if errors.Is(err, espn.ErrSignedOut) {
		m.signedOut(ctx, accountID, wrapped, "ESPN refused the cookies")
		return ErrReconnect
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
