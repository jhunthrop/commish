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
	StatusLocked    = "locked"
)

// MaxFailedSignIns locks a connection: after this many refusals in a row
// no sign-in is tried again until the member connects anew.
const MaxFailedSignIns = 3

// ErrNotConnected is an account with no connection to the host.
var ErrNotConnected = errors.New("hosts: not connected")

// Connection is one account's connection to one host, as a row keeps it.
// Sealed opens only through the Vault, in the sync worker.
type Connection struct {
	ID            uuid.UUID
	AccountID     uuid.UUID
	Host          string
	Status        string
	FailedSignIns int
	CreatedAt     time.Time
	LastReadAt    *time.Time
	Sealed        Sealed
}

// Store reads and writes app.host_connections, every query scoped by
// account and host.
type Store struct{ Pool *pgxpool.Pool }

const connColumns = `id, account_id, host, status, failed_signins, created_at, last_read_at, wrapped_key, ciphertext, key_version`

func scanConn(row pgx.Row) (Connection, error) {
	var c Connection
	err := row.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.FailedSignIns, &c.CreatedAt, &c.LastReadAt,
		&c.Sealed.WrappedKey, &c.Sealed.Ciphertext, &c.Sealed.KeyVersion)
	return c, err
}

// Put stores the account's connection to the host, connected, replacing
// any earlier one (a new sign-in clears a lock).
func (s *Store) Put(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed) (Connection, error) {
	c, err := scanConn(s.Pool.QueryRow(ctx, `insert into app.host_connections
		(account_id, host, wrapped_key, ciphertext, key_version, status, failed_signins)
		values ($1, $2, $3, $4, $5, 'connected', 0)
		on conflict (account_id, host) do update set wrapped_key = excluded.wrapped_key, ciphertext = excluded.ciphertext,
			key_version = excluded.key_version, status = 'connected', failed_signins = 0
		returning `+connColumns, accountID, host, sealed.WrappedKey, sealed.Ciphertext, sealed.KeyVersion))
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
	rows, err := s.Pool.Query(ctx, `select id, account_id, host, status, failed_signins, created_at, last_read_at
		from app.host_connections where account_id = $1 order by host`, accountID)
	if err != nil {
		return nil, fmt.Errorf("hosts: list connections: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Connection, error) {
		var c Connection
		err := r.Scan(&c.ID, &c.AccountID, &c.Host, &c.Status, &c.FailedSignIns, &c.CreatedAt, &c.LastReadAt)
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

// Renewed keeps the session a fresh sign-in got.
func (s *Store) Renewed(ctx context.Context, accountID uuid.UUID, host string, sealed Sealed) error {
	_, err := s.Pool.Exec(ctx, `update app.host_connections set wrapped_key = $3, ciphertext = $4, key_version = $5,
		status = 'connected', failed_signins = 0 where account_id = $1 and host = $2`,
		accountID, host, sealed.WrappedKey, sealed.Ciphertext, sealed.KeyVersion)
	if err != nil {
		return fmt.Errorf("hosts: renew connection: %w", err)
	}
	return nil
}

// Refused counts a refused sign-in and answers the status it leaves:
// signed out, or locked at the third in a row.
func (s *Store) Refused(ctx context.Context, accountID uuid.UUID, host string) (string, error) {
	var status string
	err := s.Pool.QueryRow(ctx, `update app.host_connections set
			failed_signins = least(failed_signins + 1, $3),
			status = case when failed_signins + 1 >= $3 then 'locked' else 'signed_out' end
		where account_id = $1 and host = $2 returning status`, accountID, host, MaxFailedSignIns).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotConnected
	}
	if err != nil {
		return "", fmt.Errorf("hosts: refused sign-in: %w", err)
	}
	return status, nil
}

// Read notes a good read as the member.
func (s *Store) Read(ctx context.Context, accountID uuid.UUID, host string, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_connections set last_read_at = $3 where account_id = $1 and host = $2`,
		accountID, host, at); err != nil {
		return fmt.Errorf("hosts: note read: %w", err)
	}
	return nil
}
