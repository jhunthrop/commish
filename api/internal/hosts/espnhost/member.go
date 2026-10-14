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
	SignedOut(ctx context.Context, accountID uuid.UUID, host string) error
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
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return espn.Cookies{}, err
	}
	if conn.Status != hosts.StatusConnected {
		return espn.Cookies{}, ErrReconnect
	}
	s, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, "the kept cookies no longer open")
		return espn.Cookies{}, ErrReconnect
	}
	if err != nil {
		return espn.Cookies{}, fmt.Errorf("espnhost: open session: %w", err)
	}
	c := espn.Cookies{SWID: s[keySWID], S2: s[keyS2]}
	if !c.Valid() {
		m.signedOut(ctx, accountID, "the kept cookies are out of shape")
		return espn.Cookies{}, ErrReconnect
	}
	return c, nil
}

// Leagues is the member's football leagues in a season.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]espn.MyLeague, error) {
	c, err := m.Cookies(ctx, accountID)
	if err != nil {
		return nil, err
	}
	list, err := m.Client.MyLeagues(ctx, c, season)
	return list, m.after(ctx, accountID, err)
}

// ReadLeague is one whole read of a league as the member.
func (m *Member) ReadLeague(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (espn.FullLeague, error) {
	c, err := m.Cookies(ctx, accountID)
	if err != nil {
		return espn.FullLeague{}, err
	}
	l, err := m.Client.Read(ctx, leagueID, season, &c)
	return l, m.after(ctx, accountID, err)
}

// after notes a good read, or marks a refused one for a reconnect.
func (m *Member) after(ctx context.Context, accountID uuid.UUID, err error) error {
	if errors.Is(err, espn.ErrSignedOut) {
		m.signedOut(ctx, accountID, "ESPN refused the cookies")
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

func (m *Member) signedOut(ctx context.Context, accountID uuid.UUID, why string) {
	m.Log.Warn("espnhost: connection needs a reconnect", "account", accountID, "why", why)
	if err := m.Store.SignedOut(ctx, accountID, Host); err != nil {
		m.Log.Warn("espnhost: mark signed out", "account", accountID, "err", err)
	}
}
