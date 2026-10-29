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
// Version 3 names what is kept, the password, inside the ticked words.
const ConsentVersion = 3

// ESPNConsentVersion is ESPN's consent words' version
// (web/src/lib/hosts/connection-words.ts ESPN_CONSENT): version 2 dropped
// the promise never to make a move (founder ruling 2026-10-15), version 3
// names the moves, and a move needs a connection made at 3 or above.
const ESPNConsentVersion = 3

// MFLConsentVersion is MyFantasyLeague's consent words' version (Lane
// 67): version 1 says the password is exchanged once and never kept, the
// session is kept encrypted, and it sets the member's lineup on
// MyFantasyLeague when they confirm a move. A move needs a connection made
// at it or above.
const MFLConsentVersion = 1

// MFLConsentWords is version 1's words exactly as the page shows them
// (web/src/lib/hosts/connection-words.ts MFL_CONSENT), kept here so a
// connection's consent version resolves to its text without the web's
// history. A test holds the two equal.
const MFLConsentWords = "We send your MyFantasyLeague password to MyFantasyLeague once to sign in, and never keep it. " +
	"We keep the session MyFantasyLeague gives back, encrypted, to set your lineup there when you confirm a move. " +
	"Disconnect deletes it at once."

// consentVersions is each host's consent words' version: FFPC's
// (ConsentVersion), Yahoo's own authorize page (version 1, the scope it
// shows: Fantasy Sports, read only), ESPN's (ESPNConsentVersion) and
// MyFantasyLeague's (MFLConsentVersion).
var consentVersions = map[string]int{"ffpc": ConsentVersion, "yahoo": 1, "espn": ESPNConsentVersion, "mfl": MFLConsentVersion}

// consentVersion is the host's consent version, 1 for a host not listed.
func consentVersion(host string) int {
	if v, ok := consentVersions[host]; ok {
		return v
	}
	return 1
}

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
	// Proven is false for an ESPN session kept before a league the public
	// cannot read was read with it; every other connection proves itself
	// on connect.
	Proven bool
	// ConsentVersion is the consent words the member agreed to on connect.
	ConsentVersion int
	Sealed         Sealed
}

// Store reads and writes app.host_connections, every query scoped by
// account and host.
type Store struct {
	Pool *pgxpool.Pool
	// OnDelete runs inside a disconnect's transaction, after the row is
	// deleted: what was kept with the session goes in the same commit
	// (leaguesync.RetireHostOffers, the member's host offers, Lane 285).
	// Nil runs nothing; a hook's error rolls the disconnect back.
	OnDelete DeleteHook
}

// DeleteHook is work a disconnect does in its own transaction.
type DeleteHook func(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, host string) error

const connColumns = `id, account_id, host, status, last_signin_at, created_at, last_read_at, proven, consent_version,
	wrapped_key, session_ct, signin_ct, key_version`

func scanConn(row pgx.Row) (Connection, error) {
	var c Connection
	err := row.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.LastSignInAt, &c.CreatedAt, &c.LastReadAt, &c.Proven, &c.ConsentVersion,
		&c.Sealed.WrappedKey, &c.Sealed.SessionCT, &c.Sealed.SignInCT, &c.Sealed.KeyVersion)
	return c, err
}

// PutConsented stores the connection as Put or PutUnproven does, at the
// consent version the member was shown, never above the host's current
// one: a member who ticked older words (a page from before a deploy) is
// kept at those words.
func (s *Store) PutConsented(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time, proven bool, shown int) (Connection, error) {
	return s.putAt(ctx, accountID, host, sealed, now, proven, max(min(shown, consentVersion(host)), 1))
}

// Put stores the account's connection to the host, connected and proven,
// replacing any earlier one, with when and to which words the member
// consented. A sign-in on our form counts as the latest sign-in.
func (s *Store) Put(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time) (Connection, error) {
	return s.put(ctx, accountID, host, sealed, now, true)
}

// PutUnproven stores the connection as Put does, not yet proven: an ESPN
// session whose leagues are all public, kept for the day a private league
// or a move needs it.
func (s *Store) PutUnproven(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time) (Connection, error) {
	return s.put(ctx, accountID, host, sealed, now, false)
}

func (s *Store) put(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time, proven bool) (Connection, error) {
	return s.putAt(ctx, accountID, host, sealed, now, proven, consentVersion(host))
}

func (s *Store) putAt(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed, now time.Time, proven bool, version int) (Connection, error) {
	c, err := scanConn(s.Pool.QueryRow(ctx, `insert into app.host_connections
		(account_id, host, wrapped_key, session_ct, signin_ct, key_version, status, last_signin_at, consented_at, consent_version, proven)
		values ($1, $2, $3, $4, $5, $6, 'connected', $7, $7, $8, $9)
		on conflict (account_id, host) do update set wrapped_key = excluded.wrapped_key, session_ct = excluded.session_ct,
			signin_ct = excluded.signin_ct, key_version = excluded.key_version, status = 'connected',
			last_signin_at = excluded.last_signin_at, consented_at = excluded.consented_at, consent_version = excluded.consent_version,
			proven = excluded.proven
		returning `+connColumns,
		accountID, host, sealed.WrappedKey, sealed.SessionCT, sealed.SignInCT, sealed.KeyVersion, now, version, proven))
	if err != nil {
		return Connection{}, fmt.Errorf("hosts: put connection: %w", err)
	}
	return c, nil
}

// Proved marks the connection proven, only if it is still the one kept
// under wrappedKey: a slow read of a connection made again since never
// proves the new one.
func (s *Store) Proved(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_connections set proven = true
		where account_id = $1 and host = $2 and wrapped_key = $3`, accountID, host, wrappedKey); err != nil {
		return fmt.Errorf("hosts: proved: %w", err)
	}
	return nil
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
	rows, err := s.Pool.Query(ctx, `select id, account_id, host, status, last_signin_at, created_at, last_read_at, proven
		from app.host_connections where account_id = $1 order by host`, accountID)
	if err != nil {
		return nil, fmt.Errorf("hosts: list connections: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Connection, error) {
		var c Connection
		err := r.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.LastSignInAt, &c.CreatedAt, &c.LastReadAt, &c.Proven)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("hosts: list connections: %w", err)
	}
	return out, nil
}

// Delete removes the account's connection: the sign-in and the session
// go with the row, and OnDelete's work commits with it.
func (s *Store) Delete(ctx context.Context, accountID uuid.UUID, host string) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `delete from app.host_connections where account_id = $1 and host = $2`, accountID, host)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotConnected
		}
		if s.OnDelete == nil {
			return nil
		}
		return s.OnDelete(ctx, tx, accountID, host)
	})
	if errors.Is(err, ErrNotConnected) {
		return err
	}
	if err != nil {
		return fmt.Errorf("hosts: delete connection: %w", err)
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

// TokensKept keeps a refreshed session and renewal, both under the row's
// own data key, guarded by the wrapped key the refresh began with as
// SessionKept is: after a reconnect a stale refresh keeps nothing. Kept
// tokens are working ones, so the connection is connected again.
func (s *Store) TokensKept(ctx context.Context, accountID uuid.UUID, host string, wrappedKey, sessionCT, renewalCT []byte) error {
	_, err := s.Pool.Exec(ctx, `update app.host_connections set session_ct = $3, signin_ct = $4, status = 'connected'
		where account_id = $1 and host = $2 and wrapped_key = $5`,
		accountID, host, sessionCT, renewalCT, wrappedKey)
	if err != nil {
		return fmt.Errorf("hosts: keep tokens: %w", err)
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

// Locked runs fn holding the account's lock for the host across every
// process (a transaction-scoped advisory lock), so two instances never
// refresh one member's tokens at once. fn reads and writes through the
// store as usual; the lock is released when it returns.
func (s *Store) Locked(ctx context.Context, accountID uuid.UUID, host string, fn func(context.Context) error) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('host_refresh:' || $1::text || ':' || $2))`,
			accountID, host); err != nil {
			return fmt.Errorf("hosts: lock %s: %w", host, err)
		}
		return fn(ctx)
	})
}

// SignedOutAt stops reading as the member until they connect again, only
// if the connection is still the one kept under wrappedKey: a slow read
// of a connection made again since never marks the new one.
func (s *Store) SignedOutAt(ctx context.Context, accountID uuid.UUID, host string, wrappedKey []byte) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_connections set status = 'signed_out'
		where account_id = $1 and host = $2 and wrapped_key = $3`, accountID, host, wrappedKey); err != nil {
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
