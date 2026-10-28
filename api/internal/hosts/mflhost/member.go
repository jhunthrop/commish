// Package mflhost keeps a member's MyFantasyLeague session in the hosts
// vault and reads their own team with it, so a lineup they confirm on our
// screen can be set on MyFantasyLeague (Lane 67). MyFantasyLeague offers
// no OAuth: the member types their username and password once, we
// exchange them at MyFantasyLeague's login for its MFL_USER_ID session
// and keep only that, sealed, with the expiry its cookie states. A
// session past its expiry, or one MyFantasyLeague refuses, marks the
// connection for a reconnect. Public leagues still follow by their link
// with none of this.
package mflhost

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/mfl"
)

// Host is this host's key in the connections table and the contract.
const Host = "mfl"

// PurposeUsername scopes the key a username's refusals are counted under.
const PurposeUsername = "commish mfl username v1"

// ErrReconnect is a connection whose session MyFantasyLeague no longer
// accepts, or one past its expiry.
var ErrReconnect = errors.New("mflhost: connect again")

// Session keys in the vault.
const (
	keyUserID  = "mfl_user_id"
	keyExpires = "expires_at"
)

// Client is the part of *mfl.Client the member's reads and the connect
// use.
type Client interface {
	Login(ctx context.Context, season int, username, password string) (mfl.Session, error)
	MyLeagues(ctx context.Context, sess mfl.Session, season int) ([]mfl.MyLeague, error)
	MemberLineup(ctx context.Context, sess mfl.Session, season int, leagueID string) (mfl.TeamLineup, error)
	PendingTrades(ctx context.Context, sess mfl.Session, server string, season int, leagueID string) ([]mfl.PendingTrade, error)
}

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	SignedOutAt(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// maxSessionLife is the longest a session is kept: a session
// MyFantasyLeague states no expiry for, or a later one, lapses here then,
// so an unused session never lives on in the vault.
const maxSessionLife = 365 * 24 * time.Hour

// Seal is a new connection's session, sealed for the account, with
// nothing beside it: the password is never kept, and MyFantasyLeague
// offers no renewal. It expires when MyFantasyLeague says, or
// maxSessionLife from now, whichever is sooner.
func Seal(v *hosts.Vault, accountID uuid.UUID, s mfl.Session, now time.Time) (hosts.Sealed, error) {
	capAt := now.Add(maxSessionLife)
	if s.Expires.IsZero() || s.Expires.After(capAt) {
		s.Expires = capAt
	}
	session := hosts.Session{keyUserID: s.UserID, keyExpires: s.Expires.UTC().Format(time.RFC3339)}
	return v.SealTokens(accountID.String(), Host, session, hosts.Session{})
}

// Member reads MyFantasyLeague with a connected member's session.
type Member struct {
	Client Client
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger
}

// kept is the member's open session and the wrapped key it was kept
// under, which guards marking it signed out.
type kept struct {
	sess    mfl.Session
	wrapped []byte
}

// Session is the member's kept session, for a read or a write: a
// connection signed out, one that does not open, or one past its expiry
// is ErrReconnect.
func (m *Member) Session(ctx context.Context, accountID uuid.UUID) (mfl.Session, error) {
	k, err := m.open(ctx, accountID)
	return k.sess, err
}

func (m *Member) open(ctx context.Context, accountID uuid.UUID) (kept, error) {
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return kept{}, err
	}
	if conn.Status != hosts.StatusConnected {
		return kept{}, ErrReconnect
	}
	wrapped := conn.Sealed.WrappedKey
	s, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, wrapped, "the kept session no longer opens")
		return kept{}, ErrReconnect
	}
	if err != nil {
		return kept{}, fmt.Errorf("mflhost: open session: %w", err)
	}
	sess := mfl.Session{UserID: s[keyUserID]}
	if at := s[keyExpires]; at != "" {
		if sess.Expires, err = time.Parse(time.RFC3339, at); err != nil {
			sess = mfl.Session{}
		}
	}
	switch {
	case !sess.Valid():
		m.signedOut(ctx, accountID, wrapped, "the kept session is out of shape")
		return kept{}, ErrReconnect
	case sess.Expired(m.Now()):
		m.signedOut(ctx, accountID, wrapped, "the kept session is past its expiry")
		return kept{}, ErrReconnect
	}
	return kept{sess: sess, wrapped: wrapped}, nil
}

// signedOut marks the connection for a reconnect, only if it is still the
// one kept under wrapped. It logs why, never the session.
func (m *Member) signedOut(ctx context.Context, accountID uuid.UUID, wrapped []byte, why string) {
	m.Log.Info("mflhost: signed out", "account", accountID, "why", why)
	if err := m.Store.SignedOutAt(ctx, accountID, Host, wrapped); err != nil {
		m.Log.Warn("mflhost: keep signed out", "account", accountID, "err", err)
	}
}

// refused turns MyFantasyLeague refusing the session into a reconnect,
// signed out; a good read is noted.
func (m *Member) refused(ctx context.Context, accountID uuid.UUID, k kept, err error) error {
	if errors.Is(err, mfl.ErrSignedOut) {
		m.signedOut(ctx, accountID, k.wrapped, "MyFantasyLeague refused the kept session")
		return ErrReconnect
	}
	if err == nil {
		if rerr := m.Store.Read(ctx, accountID, Host, m.Now()); rerr != nil {
			m.Log.Warn("mflhost: note read", "account", accountID, "err", rerr)
		}
	}
	return err
}

// Leagues is the member's leagues this season, read with their session.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID, season int) ([]mfl.MyLeague, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return nil, err
	}
	list, err := m.Client.MyLeagues(ctx, k.sess, season)
	return list, m.refused(ctx, accountID, k, err)
}

// Lineup is the member's own team in the league as their session reads
// it, and the session it read with, for a lineup move.
func (m *Member) Lineup(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (mfl.TeamLineup, mfl.Session, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return mfl.TeamLineup{}, mfl.Session{}, err
	}
	l, err := m.Client.MemberLineup(ctx, k.sess, season, leagueID)
	if err := m.refused(ctx, accountID, k, err); err != nil {
		return mfl.TeamLineup{}, mfl.Session{}, err
	}
	return l, k.sess, nil
}

// PendingTrades is the offers to and from the member's franchise in the
// league as their session reads them (Lane 279), and that franchise: the
// league must be one MyFantasyLeague lists for them.
func (m *Member) PendingTrades(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (int, []mfl.PendingTrade, error) {
	k, err := m.open(ctx, accountID)
	if err != nil {
		return 0, nil, err
	}
	mine, err := m.Client.MyLeagues(ctx, k.sess, season)
	if err := m.refused(ctx, accountID, k, err); err != nil {
		return 0, nil, err
	}
	for _, l := range mine {
		if l.LeagueID != leagueID {
			continue
		}
		list, err := m.Client.PendingTrades(ctx, k.sess, l.Server, season, leagueID)
		if err := m.refused(ctx, accountID, k, err); err != nil {
			return 0, nil, err
		}
		return l.Franchise, list, nil
	}
	return 0, nil, fmt.Errorf("%w: league %s", mfl.ErrNotYourTeam, leagueID)
}
