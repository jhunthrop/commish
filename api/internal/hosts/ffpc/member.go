package ffpc

import (
	"bytes"
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
	SessionKept(ctx context.Context, accountID uuid.UUID, host string, sessionCT []byte) error
	ClaimSignIn(ctx context.Context, accountID uuid.UUID, host string, at time.Time, every time.Duration) (bool, error)
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
		jar, kept, err = m.mend(ctx, accountID, conn, read)
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

// mend answers a read FFPC sent away. Exactly one process may sign in
// again for a member in a SignInEvery: it claims the sign-in on the row in
// one statement. A process that loses the claim re-reads the row once: a
// session another process kept meanwhile is tried, and only if that read
// is sent away too (or there is none) is the member marked signed out.
// It answers the read and the session it was made with.
func (m *Member) mend(ctx context.Context, accountID uuid.UUID, conn hosts.Connection, read func(Cookies) (Cookies, error)) (Cookies, Cookies, error) {
	claimed, err := m.Store.ClaimSignIn(ctx, accountID, Host, m.Now(), SignInEvery)
	if err != nil {
		return nil, nil, err
	}
	if !claimed {
		return m.fresher(ctx, accountID, conn, read)
	}
	session, err := m.renew(ctx, accountID, conn)
	if err != nil {
		return nil, nil, err
	}
	jar, err := read(session)
	if errors.Is(err, ErrSignedOut) {
		m.signedOut(ctx, accountID, "a read was still sent away after a fresh sign-in")
		return nil, nil, ErrNeedsSignIn
	}
	return jar, session, err
}

// fresher tries a session another process kept since this read began,
// once; with none, or one FFPC also sends away, the member is signed out.
func (m *Member) fresher(ctx context.Context, accountID uuid.UUID, conn hosts.Connection, read func(Cookies) (Cookies, error)) (Cookies, Cookies, error) {
	fresh, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return nil, nil, err
	}
	if fresh.Status == hosts.StatusConnected && !bytes.Equal(fresh.Sealed.SessionCT, conn.Sealed.SessionCT) {
		if s, err := m.Vault.OpenSession(accountID.String(), Host, fresh.Sealed); err == nil {
			jar, err := read(Cookies(s))
			if !errors.Is(err, ErrSignedOut) {
				return jar, Cookies(s), err
			}
		}
	}
	m.signedOut(ctx, accountID, "signed out again within six hours of a sign-in")
	return nil, nil, ErrNeedsSignIn
}

// renew signs in again with the kept sign-in, once the sign-in is claimed.
// Every outcome but a clean sign-in marks the connection signed out.
func (m *Member) renew(ctx context.Context, accountID uuid.UUID, conn hosts.Connection) (Cookies, error) {
	in, err := m.Vault.OpenSignIn(accountID.String(), Host, conn.Sealed)
	if err != nil {
		m.signedOut(ctx, accountID, "the kept sign-in no longer opens")
		return nil, ErrNeedsSignIn
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

// keep seals a new session under the row's own data key and keeps the
// session ciphertext alone.
func (m *Member) keep(ctx context.Context, accountID uuid.UUID, sealed hosts.Sealed, jar Cookies) error {
	next, err := m.Vault.Reseal(accountID.String(), Host, sealed, hosts.Session(jar))
	if err != nil {
		return err
	}
	return m.Store.SessionKept(ctx, accountID, Host, next.SessionCT)
}
