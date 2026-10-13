package ffpc

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"maps"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// Host is this host's key in the connections table and the contract.
const Host = "ffpc"

// SignInEvery is the most often a kept sign-in is tried for one member:
// a member's FFPC account is never hammered by us.
const SignInEvery = 6 * time.Hour

// ErrNeedsSignIn is a connection FFPC no longer honors: the member signs
// in again on our form.
var ErrNeedsSignIn = errors.New("ffpc: sign in again")

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	SessionKept(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed) error
	SignInTried(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
	SignedOut(ctx context.Context, accountID uuid.UUID, host string) error
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// Member reads FFPC as a connected member. Every read opens only the
// session. When FFPC no longer honors it, the kept sign-in is opened and
// tried once, and only if none was tried for this member in SignInEvery.
// Anything but a clean renewal followed by a clean read (a refusal, a
// sign-in page that changed, a page we do not know, a read still sent
// away) marks the connection signed out, with no retry, and the member is
// told to sign in again.
type Member struct {
	Client *Client
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger

	// locks serialize one member's reads, a fixed set shared by hash so it
	// never grows.
	locks [64]sync.Mutex
}

func (m *Member) lock(accountID uuid.UUID) func() {
	h := fnv.New32a()
	_, _ = h.Write(accountID[:])
	mu := &m.locks[h.Sum32()%uint32(len(m.locks))]
	mu.Lock()
	return mu.Unlock
}

// connection is the member's connection, for one that reads. A row that
// no longer opens (the key rotated away) is marked signed out.
func (m *Member) connection(ctx context.Context, accountID uuid.UUID) (hosts.Connection, Cookies, error) {
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return hosts.Connection{}, nil, err
	}
	if conn.Status != hosts.StatusConnected {
		return hosts.Connection{}, nil, ErrNeedsSignIn
	}
	session, err := m.Vault.OpenSession(accountID.String(), Host, conn.Sealed)
	if errors.Is(err, hosts.ErrSealed) {
		m.signedOut(ctx, accountID, "the kept session no longer opens")
		return hosts.Connection{}, nil, ErrNeedsSignIn
	}
	if err != nil {
		return hosts.Connection{}, nil, fmt.Errorf("ffpc: open session: %w", err)
	}
	return conn, Cookies(session), nil
}

func (m *Member) signedOut(ctx context.Context, accountID uuid.UUID, why string) {
	m.Log.Warn("ffpc: connection signed out", "account", accountID, "why", why)
	if err := m.Store.SignedOut(ctx, accountID, Host); err != nil {
		m.Log.Warn("ffpc: mark signed out", "account", accountID, "err", err)
	}
}

// Pages reads the named league pages as the member, in order.
func (m *Member) Pages(ctx context.Context, accountID uuid.UUID, ltuid string, pages ...PageName) (map[PageName][]byte, error) {
	out := map[PageName][]byte{}
	err := m.as(ctx, accountID, func(jar Cookies) (Cookies, error) {
		for _, p := range pages {
			if _, done := out[p]; done {
				continue
			}
			body, next, err := m.Client.Page(ctx, jar, p, ltuid)
			jar = next
			if err != nil {
				return jar, err
			}
			out[p] = body
		}
		return jar, nil
	})
	return out, err
}

// Leagues is the member's leagues from My Teams.
func (m *Member) Leagues(ctx context.Context, accountID uuid.UUID) ([]MyLeague, error) {
	var out []MyLeague
	err := m.as(ctx, accountID, func(jar Cookies) (Cookies, error) {
		list, err := m.Client.MyTeams(ctx, jar)
		out = list
		return jar, err
	})
	return out, err
}

// OpenLeague is the member's own league-team id in one of their leagues.
func (m *Member) OpenLeague(ctx context.Context, accountID uuid.UUID, leagueID string) (string, error) {
	var out string
	err := m.as(ctx, accountID, func(jar Cookies) (Cookies, error) {
		ltuid, err := m.Client.OpenLeague(ctx, jar, leagueID)
		out = ltuid
		return jar, err
	})
	return out, err
}

// as runs read with the member's session, renewing it at most once (and
// at most once a SignInEvery), and keeps any cookie FFPC changed.
func (m *Member) as(ctx context.Context, accountID uuid.UUID, read func(Cookies) (Cookies, error)) error {
	defer m.lock(accountID)()
	conn, kept, err := m.connection(ctx, accountID)
	if err != nil {
		return err
	}
	jar, err := read(kept)
	if errors.Is(err, ErrSignedOut) {
		if jar, err = m.renew(ctx, accountID, conn); err != nil {
			return err
		}
		kept = jar
		if jar, err = read(jar); errors.Is(err, ErrSignedOut) {
			m.signedOut(ctx, accountID, "a read was still sent away after a fresh sign-in")
			return ErrNeedsSignIn
		}
	}
	if err != nil {
		return err
	}
	if !maps.Equal(jar, kept) {
		if err := m.keep(ctx, accountID, conn.Sealed, jar); err != nil {
			m.Log.Warn("ffpc: keep session", "account", accountID, "err", err)
		}
	}
	if err := m.Store.Read(ctx, accountID, Host, m.Now()); err != nil {
		m.Log.Warn("ffpc: note read", "account", accountID, "err", err)
	}
	return nil
}

// renew signs in again with the kept sign-in, only if none was tried in
// SignInEvery. The try is noted before it is sent. Every outcome but a
// clean sign-in marks the connection signed out.
func (m *Member) renew(ctx context.Context, accountID uuid.UUID, conn hosts.Connection) (Cookies, error) {
	now := m.Now()
	if conn.LastSignInAt != nil && now.Sub(*conn.LastSignInAt) < SignInEvery {
		m.signedOut(ctx, accountID, "signed out again within six hours of a sign-in")
		return nil, ErrNeedsSignIn
	}
	in, err := m.Vault.OpenSignIn(accountID.String(), Host, conn.Sealed)
	if err != nil {
		m.signedOut(ctx, accountID, "the kept sign-in no longer opens")
		return nil, ErrNeedsSignIn
	}
	if err := m.Store.SignInTried(ctx, accountID, Host, now); err != nil {
		return nil, err
	}
	jar, _, err := m.Client.SignIn(ctx, in.Username, in.Password)
	switch {
	case errors.Is(err, ErrBadSignIn), errors.Is(err, ErrFormChanged), errors.Is(err, ErrUnexpected):
		m.signedOut(ctx, accountID, err.Error())
		return nil, ErrNeedsSignIn
	case err != nil:
		return nil, err
	}
	return jar, m.keep(ctx, accountID, conn.Sealed, jar)
}

func (m *Member) keep(ctx context.Context, accountID uuid.UUID, sealed hosts.Sealed, jar Cookies) error {
	next, err := m.Vault.Reseal(accountID.String(), Host, sealed, hosts.Session(jar))
	if err != nil {
		return err
	}
	return m.Store.SessionKept(ctx, accountID, Host, next)
}
