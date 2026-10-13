package hosts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connection states.
const (
	StatusConnected = "connected"
	StatusSignedOut = "signed_out"
)

// ConsentVersion names the consent words a member agreed to on connect
// (web/src/lib/hosts/api.ts FFPC_CONSENT). Raise it when the words change.
const ConsentVersion = 2

// ErrNotConnected is an account with no connection to the host.
var ErrNotConnected = errors.New("hosts: not connected")

// Connection is one account's connection to one host, as a row keeps it.
// Sealed opens only through the Vault, in the sync worker.
type Connection struct {
	ID           uuid.UUID
	AccountID    uuid.UUID
	Host         string
	Status       string
	LastSignInAt *time.Time
	CreatedAt    time.Time
	LastReadAt   *time.Time
	Sealed       Sealed
}

// Store reads and writes app.host_connections, every query scoped by
// account and host.
type Store struct{ Pool *pgxpool.Pool }

const connColumns = `id, account_id, host, status, last_signin_at, created_at, last_read_at,
	wrapped_key, session_ct, signin_ct, key_version`

func scanConn(row pgx.Row) (Connection, error) {
	var c Connection
	err := row.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.LastSignInAt, &c.CreatedAt, &c.LastReadAt,
		&c.Sealed.WrappedKey, &c.Sealed.SessionCT, &c.Sealed.SignInCT, &c.Sealed.KeyVersion)
	return c, err
}

// Put stores the account's connection to the host, connected, replacing
// any earlier one, with when and to which words the member consented. A
// sign-in on our form counts as the latest sign-in.
func (s *Store) Put(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time) (Connection, error) {
	c, err := scanConn(s.Pool.QueryRow(ctx, `insert into app.host_connections
		(account_id, host, wrapped_key, session_ct, signin_ct, key_version, status, last_signin_at, consented_at, consent_version)
		values ($1, $2, $3, $4, $5, $6, 'connected', $7, $7, $8)
		on conflict (account_id, host) do update set wrapped_key = excluded.wrapped_key, session_ct = excluded.session_ct,
			signin_ct = excluded.signin_ct, key_version = excluded.key_version, status = 'connected',
			last_signin_at = excluded.last_signin_at, consented_at = excluded.consented_at, consent_version = excluded.consent_version
		returning `+connColumns,
		accountID, host, sealed.WrappedKey, sealed.SessionCT, sealed.SignInCT, sealed.KeyVersion, now, ConsentVersion))
	if err != nil {
		return Connection{}, fmt.Errorf("hosts: put connection: %w", err)
	}
	return c, nil
}

// Get is the account's connection to the host.
func (s *Store) Get(ctx context.Context, accountID uuid.UUID, host string) (Connection, error) {
	c, err := scanConn(s.Pool.QueryRow(ctx, `select `+connColumns+` from app.host_connections
		where account_id = $1 and host = $2`, accountID, host))
	if errors.Is(err, pgx.ErrNoRows) {
		return Connection{}, ErrNotConnected
	}
	if err != nil {
		return Connection{}, fmt.Errorf("hosts: get connection: %w", err)
	}
	return c, nil
}

// List is the account's connections, for the account page; the sealed
// columns are not read.
func (s *Store) List(ctx context.Context, accountID uuid.UUID) ([]Connection, error) {
	rows, err := s.Pool.Query(ctx, `select id, account_id, host, status, last_signin_at, created_at, last_read_at
		from app.host_connections where account_id = $1 order by host`, accountID)
	if err != nil {
		return nil, fmt.Errorf("hosts: list connections: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Connection, error) {
		var c Connection
		err := r.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.LastSignInAt, &c.CreatedAt, &c.LastReadAt)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("hosts: list connections: %w", err)
	}
	return out, nil
}

// Delete removes the account's connection: the sign-in and the session
// go with the row.
func (s *Store) Delete(ctx context.Context, accountID uuid.UUID, host string) error {
	tag, err := s.Pool.Exec(ctx, `delete from app.host_connections where account_id = $1 and host = $2`, accountID, host)
	if err != nil {
		return fmt.Errorf("hosts: delete connection: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotConnected
	}
	return nil
}

// SessionKept keeps a new session: the session ciphertext only. A new
// session is sealed under the row's own data key, so the wrapped key and
// its version are never written here, and a re-encrypt that lands while a
// read is in flight is never undone by it.
//
// It is guarded by the wrapped key the read began with: after a reconnect
// (a new data key) a stale read keeps nothing, so a session never lands
// under a key that cannot open it. A kept session is a working one, so it
// puts the connection back to connected (a process that lost the sign-in
// claim may have signed it out while the winner's sign-in was in flight).
func (s *Store) SessionKept(ctx context.Context, accountID uuid.UUID, host string, wrappedKey, sessionCT []byte) error {
	_, err := s.Pool.Exec(ctx, `update app.host_connections set session_ct = $3, status = 'connected'
		where account_id = $1 and host = $2 and wrapped_key = $4`,
		accountID, host, sessionCT, wrappedKey)
	if err != nil {
		return fmt.Errorf("hosts: keep session: %w", err)
	}
	return nil
}

// ClaimSignIn claims the member's one kept sign-in for the window: it
// writes last_signin_at only when none was tried in the window, in one
// statement, so of every process that finds the same expired session
// exactly one signs in. The claim is noted before the sign-in is sent, so
// a crash between the two still counts it.
func (s *Store) ClaimSignIn(ctx context.Context, accountID uuid.UUID, host string, at time.Time, every time.Duration) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `update app.host_connections set last_signin_at = $3
		where account_id = $1 and host = $2 and status = 'connected'
			and (last_signin_at is null or last_signin_at <= $3 - $4::interval)`,
		accountID, host, at, fmt.Sprintf("%d milliseconds", every.Milliseconds()))
	if err != nil {
		return false, fmt.Errorf("hosts: claim sign-in: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SignedOut stops reading as the member until they sign in again.
func (s *Store) SignedOut(ctx context.Context, accountID uuid.UUID, host string) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_connections set status = 'signed_out' where account_id = $1 and host = $2`,
		accountID, host); err != nil {
		return fmt.Errorf("hosts: signed out: %w", err)
	}
	return nil
}

// Read notes a good read as the member.
func (s *Store) Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_connections set last_read_at = $3 where account_id = $1 and host = $2`,
		accountID, host, at); err != nil {
		return fmt.Errorf("hosts: note read: %w", err)
	}
	return nil
}

// Refused keeps a sign-in on our form the host refused.
func (s *Store) Refused(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `insert into app.host_connect_refusals (account_id, host, at) values ($1, $2, $3)`,
		accountID, host, at); err != nil {
		return fmt.Errorf("hosts: keep refusal: %w", err)
	}
	return nil
}

// Refusals counts the account's refused sign-ins since a moment, and
// drops the ones older than it.
func (s *Store) Refusals(ctx context.Context, accountID uuid.UUID, host string, since time.Time) (int, error) {
	if _, err := s.Pool.Exec(ctx, `delete from app.host_connect_refusals where account_id = $1 and host = $2 and at < $3`,
		accountID, host, since); err != nil {
		return 0, fmt.Errorf("hosts: trim refusals: %w", err)
	}
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from app.host_connect_refusals where account_id = $1 and host = $2`,
		accountID, host).Scan(&n); err != nil {
		return 0, fmt.Errorf("hosts: count refusals: %w", err)
	}
	return n, nil
}

// Wrapped is one row's sealed data key, for the re-encrypt job.
type Wrapped struct {
	AccountID uuid.UUID
	Host      string
	Sealed    Sealed
}

// NotAt is every row wrapped under a key version other than current.
func (s *Store) NotAt(ctx context.Context, current int) ([]Wrapped, error) {
	rows, err := s.Pool.Query(ctx, `select account_id, host, wrapped_key, session_ct, signin_ct, key_version
		from app.host_connections where key_version <> $1 order by account_id, host`, current)
	if err != nil {
		return nil, fmt.Errorf("hosts: rows to re-encrypt: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Wrapped, error) {
		var w Wrapped
		err := r.Scan(&w.AccountID, &w.Host, &w.Sealed.WrappedKey, &w.Sealed.SessionCT, &w.Sealed.SignInCT, &w.Sealed.KeyVersion)
		return w, err
	})
	if err != nil {
		return nil, fmt.Errorf("hosts: rows to re-encrypt: %w", err)
	}
	return out, nil
}

// Rewrapped keeps a row's data key wrapped under a new version, only if
// the row is still at the version it was read at.
func (s *Store) Rewrapped(ctx context.Context, w Wrapped, from int) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `update app.host_connections set wrapped_key = $3, key_version = $4
		where account_id = $1 and host = $2 and key_version = $5`,
		w.AccountID, w.Host, w.Sealed.WrappedKey, w.Sealed.KeyVersion, from)
	if err != nil {
		return false, fmt.Errorf("hosts: keep re-wrap: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
