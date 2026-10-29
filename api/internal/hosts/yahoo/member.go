package yahoo

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// RefreshWithin is how near its expiry an access token is refreshed
// before a read rather than after a refusal.
const RefreshWithin = 5 * time.Minute

// ErrReconnect is a connection Yahoo no longer honors: its refresh was
// refused, so the member connects again.
var ErrReconnect = errors.New("yahoo: connect again")

// Session and renewal keys in the vault.
const (
	keyAccess  = "access"
	keyExpires = "expires"
	keyRefresh = "refresh"
)

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	TokensKept(ctx context.Context, accountID uuid.UUID, host string, wrappedKey, sessionCT, renewalCT []byte) error
	SignedOutAt(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error
	Locked(ctx context.Context, accountID uuid.UUID, host string, fn func(context.Context) error) error
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// Refresher trades a refresh token for new tokens. *OAuth implements it.
type Refresher interface {
	Refresh(ctx context.Context, refresh string, now time.Time) (Tokens, error)
}

// Member reads Yahoo as a connected member. Every read opens the access
// token only; the refresh token is opened only to refresh, when the
// access token is within RefreshWithin of its expiry or Yahoo refused it.
// A refresh Yahoo refuses marks the connection signed out, with no retry.
type Member struct {
	Client *Client
	OAuth  Refresher
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger

	// locks serialize one member's reads, so two reads never refresh at
	// once: a fixed set shared by hash, so it never grows.
	locks [64]sync.Mutex

	mu       sync.Mutex
	gameKeys map[int]string
}

func (m *Member) lock(accountID uuid.UUID) func() {
	h := fnv.New32a()
	_, _ = h.Write(accountID[:])
	mu := &m.locks[h.Sum32()%uint32(len(m.locks))]
	mu.Lock()
	return mu.Unlock
}

// Seal is a new connection's tokens, sealed for the account.
func Seal(v *hosts.Vault, accountID uuid.UUID, t Tokens) (hosts.Sealed, error) {
	return v.SealTokens(accountID.String(), Host, session(t), hosts.Session{keyRefresh: t.Refresh})
}

func session(t Tokens) hosts.Session {
	return hosts.Session{keyAccess: t.Access, keyExpires: t.Expiry.UTC().Format(time.RFC3339)}
}

// Leagues is the member's leagues in the current season's game.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID) ([]MyLeague, error) {
	var out []MyLeague
	err := m.as(ctx, accountID, func(access string) error {
		list, err := m.Client.MyLeagues(ctx, access)
		out = list
		return err
	})
	return out, err
}

// ReadLeague is one whole read of a league in a season, as the member;
// season 0 is the current season's game, as the member's league list
// names it.
func (m *Member) ReadLeague(ctx context.Context, accountID uuid.UUID, season int, leagueID string) (League, error) {
	var out League
	err := m.as(ctx, accountID, func(access string) error {
		key, err := m.leagueKey(ctx, access, season, leagueID)
		if err != nil {
			return err
		}
		l, err := m.Client.League(ctx, access, key)
		if err == nil && l.WaiversErr != nil {
			m.Log.Warn("yahoo: waiver wire not read, waiver status unknown", "league", key, "err", l.WaiversErr)
		}
		out = l
		return err
	})
	return out, err
}

// Scoreboards is each week's scoreboard of a league, as the member, one
// documented request a week inside the client's pace (Lane 298). A read
// that fails partway answers the weeks read before it with the error.
func (m *Member) Scoreboards(ctx context.Context, accountID uuid.UUID, season int, leagueID string, weeks []int) ([]Scoreboard, error) {
	var out []Scoreboard
	err := m.as(ctx, accountID, func(access string) error {
		key, err := m.leagueKey(ctx, access, season, leagueID)
		if err != nil {
			return err
		}
		out = out[:0]
		for _, week := range weeks {
			sb, err := m.Client.Scoreboard(ctx, access, key, week)
			if err != nil {
				return err
			}
			out = append(out, sb)
		}
		return nil
	})
	return out, err
}

// leagueKey is the league's key in the season's game; season 0 is the
// current season's game.
func (m *Member) leagueKey(ctx context.Context, access string, season int, leagueID string) (string, error) {
	gameKey := currentGame
	if season != 0 {
		key, err := m.gameKey(ctx, access, season)
		if err != nil {
			return "", err
		}
		gameKey = key
	}
	return LeagueKey(gameKey, leagueID)
}

// gameKey is the season's game key, read once a process.
func (m *Member) gameKey(ctx context.Context, access string, season int) (string, error) {
	m.mu.Lock()
	key, ok := m.gameKeys[season]
	m.mu.Unlock()
	if ok {
		return key, nil
	}
	key, err := m.Client.GameKey(ctx, access, season)
	if err != nil {
		return "", err
	}
	m.mu.Lock()
	if m.gameKeys == nil {
		m.gameKeys = map[int]string{}
	}
	m.gameKeys[season] = key
	m.mu.Unlock()
	return key, nil
}

// as runs read with the member's access token, refreshed first when it
// is near its expiry, and refreshed once more if Yahoo refuses it.
func (m *Member) as(ctx context.Context, accountID uuid.UUID, read func(access string) error) error {
	defer m.lock(accountID)()
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return err
	}
	if conn.Status != hosts.StatusConnected {
		return ErrReconnect
	}
	access, expiry, err := m.open(ctx, accountID, conn)
	if err != nil {
		return err
	}
	refreshed := false
	if m.Now().Add(RefreshWithin).After(expiry) {
		if access, err = m.refresh(ctx, accountID, ""); err != nil {
			return err
		}
		refreshed = true
	}
	err = read(access)
	if errors.Is(err, ErrUnauthorized) && !refreshed {
		if access, err = m.refresh(ctx, accountID, access); err != nil {
			return err
		}
		err = read(access)
	}
	if errors.Is(err, ErrUnauthorized) {
		m.signedOut(ctx, accountID, conn.Sealed.WrappedKey, "a fresh access token was refused")
		return ErrReconnect
	}
	if err != nil {
		return err
	}
	if err := m.Store.Read(ctx, accountID, Host, m.Now()); err != nil {
		m.Log.Warn("yahoo: note read", "account", accountID, "err", err)
	}
	return nil
}

// open is the kept access token and its expiry. A row that no longer
// opens (the key rotated away) is marked signed out.
func (m *Member) open(ctx context.Context, accountID uuid.UUID, conn hosts.Connection) (string, time.Time, error) {
	s, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, conn.Sealed.WrappedKey, "the kept tokens no longer open")
		return "", time.Time{}, ErrReconnect
	}
	if err != nil {
		return "", time.Time{}, fmt.Errorf("yahoo: open session: %w", err)
	}
	expiry, err := time.Parse(time.RFC3339, s[keyExpires])
	if err != nil || s[keyAccess] == "" {
		// A session we cannot read is treated as expired: the refresh
		// mends it.
		return "", time.Time{}, nil
	}
	return s[keyAccess], expiry, nil
}

// refresh answers a fresh access token, under the account's lock across
// every process. The row is read again under the lock: when another
// process refreshed meanwhile (a token neither near its expiry nor the
// refused one), that token is used and Yahoo is not asked again.
// Otherwise the kept refresh token is traded and the new tokens kept;
// Yahoo refusing it signs the connection out.
func (m *Member) refresh(ctx context.Context, accountID uuid.UUID, refused string) (string, error) {
	var access string
	err := m.Store.Locked(ctx, accountID, Host, func(ctx context.Context) error {
		conn, err := m.Store.Get(ctx, accountID, Host)
		if err != nil {
			return err
		}
		if conn.Status != hosts.StatusConnected {
			return ErrReconnect
		}
		kept, expiry, err := m.open(ctx, accountID, conn)
		if err != nil {
			return err
		}
		if kept != "" && kept != refused && !m.Now().Add(RefreshWithin).After(expiry) {
			access = kept
			return nil
		}
		access, err = m.trade(ctx, accountID, conn)
		return err
	})
	return access, err
}

// trade trades the connection's refresh token for new tokens and keeps
// them under the row's own key.
func (m *Member) trade(ctx context.Context, accountID uuid.UUID, conn hosts.Connection) (string, error) {
	renewal, err := m.Vault.OpenRenewal(accountID.String(), Host, conn.Sealed)
	if err != nil || renewal[keyRefresh] == "" {
		m.signedOut(ctx, accountID, conn.Sealed.WrappedKey, "the kept refresh token no longer opens")
		return "", ErrReconnect
	}
	t, err := m.OAuth.Refresh(ctx, renewal[keyRefresh], m.Now())
	if errors.Is(err, ErrRefused) {
		m.signedOut(ctx, accountID, conn.Sealed.WrappedKey, "Yahoo refused the refresh")
		return "", ErrReconnect
	}
	if err != nil {
		return "", err
	}
	next, err := m.Vault.ResealTokens(accountID.String(), Host, conn.Sealed, session(t), hosts.Session{keyRefresh: t.Refresh})
	if err != nil {
		return "", err
	}
	if err := m.Store.TokensKept(ctx, accountID, Host, conn.Sealed.WrappedKey, next.SessionCT, next.SignInCT); err != nil {
		// The access token works for this read; the next read refreshes
		// again with the kept refresh token.
		m.Log.Warn("yahoo: keep tokens", "account", accountID, "err", err)
	}
	return t.Access, nil
}

// signedOut marks the connection the read began with for a reconnect; a
// connection made again since keeps its state.
func (m *Member) signedOut(ctx context.Context, accountID uuid.UUID, wrapped []byte, why string) {
	m.Log.Warn("yahoo: connection needs a reconnect", "account", accountID, "why", why)
	if err := m.Store.SignedOutAt(ctx, accountID, Host, wrapped); err != nil {
		m.Log.Warn("yahoo: mark signed out", "account", accountID, "err", err)
	}
}
