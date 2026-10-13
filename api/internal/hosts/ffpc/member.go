package ffpc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts"
)

// Host is this host's key in the connections table and the contract.
const Host = "ffpc"

// ErrNeedsSignIn is a connection FFPC no longer honors: signed out or
// locked. The member signs in again on our form.
var ErrNeedsSignIn = errors.New("ffpc: sign in again")

// Connections is the part of hosts.Store a member read needs.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
	Renewed(ctx context.Context, accountID uuid.UUID, host string, sealed hosts.Sealed) error
	Refused(ctx context.Context, accountID uuid.UUID, host string) (string, error)
	Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error
}

// Member reads FFPC as a connected member: it opens the member's kept
// session (only here, in the sync worker), reads pages with it, and when
// FFPC no longer honors the session, signs in again once with the kept
// sign-in, the only way FFPC renews a session. A refused sign-in is
// counted; the third locks the connection.
type Member struct {
	Client *Client
	Store  Connections
	Vault  *hosts.Vault
	Now    func() time.Time
	Log    *slog.Logger

	locks sync.Map // account id -> *sync.Mutex
}

func (m *Member) lock(accountID uuid.UUID) func() {
	mu, _ := m.locks.LoadOrStore(accountID, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	return mu.(*sync.Mutex).Unlock
}

// session is the member's kept secret, for a connection that reads.
func (m *Member) session(ctx context.Context, accountID uuid.UUID) (hosts.Secret, error) {
	conn, err := m.Store.Get(ctx, accountID, Host)
	if err != nil {
		return hosts.Secret{}, err
	}
	if conn.Status != hosts.StatusConnected {
		return hosts.Secret{}, ErrNeedsSignIn
	}
	secret, err := m.Vault.Open(accountID.String(), Host, conn.Sealed)
	if err != nil {
		return hosts.Secret{}, fmt.Errorf("ffpc: open connection: %w", err)
	}
	return secret, nil
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

// as runs read with the member's session, renewing it once when FFPC
// signs it out, and keeps any cookie FFPC changed.
func (m *Member) as(ctx context.Context, accountID uuid.UUID, read func(Cookies) (Cookies, error)) error {
	defer m.lock(accountID)()
	secret, err := m.session(ctx, accountID)
	if err != nil {
		return err
	}
	kept := Cookies(secret.Cookies)
	jar, err := read(kept)
	if errors.Is(err, ErrSignedOut) {
		if jar, err = m.renew(ctx, accountID, secret); err == nil {
			kept = jar
			jar, err = read(jar)
		}
	}
	if err != nil {
		return err
	}
	if !maps.Equal(jar, kept) {
		if err := m.keep(ctx, accountID, secret, jar); err != nil {
			m.Log.Warn("ffpc: keep session", "account", accountID, "err", err)
		}
	}
	if err := m.Store.Read(ctx, accountID, Host, m.Now()); err != nil {
		m.Log.Warn("ffpc: note read", "account", accountID, "err", err)
	}
	return nil
}

// renew signs in again with the kept sign-in. A refusal is counted and
// answered as ErrNeedsSignIn.
func (m *Member) renew(ctx context.Context, accountID uuid.UUID, secret hosts.Secret) (Cookies, error) {
	jar, _, err := m.Client.SignIn(ctx, secret.Username, secret.Password)
	if errors.Is(err, ErrBadSignIn) {
		status, rerr := m.Store.Refused(ctx, accountID, Host)
		if rerr != nil {
			return nil, rerr
		}
		m.Log.Warn("ffpc: kept sign-in refused", "account", accountID, "status", status)
		return nil, ErrNeedsSignIn
	}
	if err != nil {
		return nil, err
	}
	return jar, m.keep(ctx, accountID, secret, jar)
}

func (m *Member) keep(ctx context.Context, accountID uuid.UUID, secret hosts.Secret, jar Cookies) error {
	secret.Cookies = jar
	sealed, err := m.Vault.Seal(accountID.String(), Host, secret)
	if err != nil {
		return err
	}
	return m.Store.Renewed(ctx, accountID, Host, sealed)
}
